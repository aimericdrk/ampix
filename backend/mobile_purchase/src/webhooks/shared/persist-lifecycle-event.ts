import type { Environment, OwnershipType, Prisma, ProductType, Store, Subscription, Transaction } from '../../../generated/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { applyLifecycleEvent } from '../../subscriptions/lifecycle/subscription-lifecycle-reducer';
import {
  toPersistableSubscriptionState,
  type SubscriptionState,
} from '../../subscriptions/lifecycle/subscription-lifecycle.types';
import type { SubscriptionLifecycleEvent } from '../../subscriptions/lifecycle/subscription-lifecycle.types';
import { toSubscriptionState } from './to-subscription-state';

/**
 * M3b: the store-agnostic persistence core M2b's `AppleIngestService.processJournaledNotification`
 * was extracted from (design's explicit goal: "the transition logic lives in one place, not
 * duplicated per store" — the same principle that already produced the shared
 * `SubscriptionLifecycleEvent` alphabet + reducer, now extended to the persistence step that
 * consumes them). Both `AppleIngestService` and `GoogleIngestService` call into this module; each
 * owns everything store-specific (JWS/RTDN decode, the authoritative Google fetch, mapping to
 * `SubscriptionLifecycleEvent`, resolving the customer token) and hands this module only the
 * already-normalized inputs.
 *
 * Not covered here: Google's `voidedPurchaseNotification` handling (marking a PRE-EXISTING
 * Transaction's `revokedAt` rather than upserting new transaction facts) and Google's
 * `linkedPurchaseToken` token-rotation re-keying both need a differently-shaped write than the
 * "upsert transaction, then upsert-by-identity the subscription" flow below — `GoogleIngestService`
 * composes `applySubscriptionLifecycle` (exported below) directly for those two cases instead of
 * the top-level `persistLifecycleEvent`. See `google-ingest.service.ts` for both.
 */

export interface ResolvedApp {
  id: string;
  projectId: string;
}

/** The Subscription row's per-store identity — design §2's two `@@unique` constraints
 * (`[projectId, store, originalTransactionId]` for Apple, `[projectId, store, purchaseToken]` for
 * Google). A discriminated union rather than reusing the column names directly, so this module
 * doesn't need to know which store it's for beyond this one value. */
export type SubscriptionIdentity =
  | { kind: 'originalTransactionId'; value: string }
  | { kind: 'purchaseToken'; value: string };

/** The store-agnostic facts needed to upsert one `Transaction` row (design §2) — Apple's
 * `signedTransactionInfo` and Google's fetched `SubscriptionPurchaseV2`/`purchases.products.get`
 * both reduce to this same shape. `storeTransactionId` is Apple's `transactionId` / Google's
 * `orderId`; `originalTransactionId` is Apple-only (Google has no equivalent stable id distinct
 * from its rotating `purchaseToken` — design §7 — so Google callers pass `null`). */
export interface TransactionFacts {
  storeTransactionId: string;
  originalTransactionId?: string | null;
  storeProductId: string;
  type: ProductType;
  purchasedAt: Date;
  expiresAt?: Date | null;
  priceCents?: number | null;
  currency?: string | null;
  revokedAt?: Date | null;
  rawPayload: Prisma.InputJsonValue;
}

export function subscriptionIdentityWhere(projectId: string, store: Store, identity: SubscriptionIdentity) {
  return identity.kind === 'originalTransactionId'
    ? { projectId_store_originalTransactionId: { projectId, store, originalTransactionId: identity.value } }
    : { projectId_store_purchaseToken: { projectId, store, purchaseToken: identity.value } };
}

function subscriptionIdentityMatches(row: Subscription, identity: SubscriptionIdentity): boolean {
  return identity.kind === 'originalTransactionId'
    ? row.originalTransactionId === identity.value
    : row.purchaseToken === identity.value;
}

export interface UpsertLifecycleTransactionInput {
  prisma: PrismaService;
  app: ResolvedApp;
  store: Store;
  environment: Environment;
  facts: TransactionFacts;
  customerId: string | null;
}

/** Always upserts the Transaction — the immutable revenue ledger and the unlinked-replay anchor
 * (design §7/§10): both stores record revenue immediately, even before a customer is attributed.
 * Idempotent on `[projectId, store, storeTransactionId]`. */
export function upsertLifecycleTransaction(input: UpsertLifecycleTransactionInput): Promise<Transaction> {
  const { prisma, app, store, environment, facts, customerId } = input;
  const data = {
    projectId: app.projectId,
    customerId: customerId ?? null,
    appId: app.id,
    store,
    environment,
    storeTransactionId: facts.storeTransactionId,
    originalTransactionId: facts.originalTransactionId ?? null,
    storeProductId: facts.storeProductId,
    type: facts.type,
    purchasedAt: facts.purchasedAt,
    expiresAt: facts.expiresAt ?? null,
    priceCents: facts.priceCents ?? null,
    currency: facts.currency ?? null,
    revokedAt: facts.revokedAt ?? null,
    rawPayload: facts.rawPayload,
  };
  return prisma.transaction.upsert({
    where: {
      projectId_store_storeTransactionId: {
        projectId: app.projectId,
        store,
        storeTransactionId: facts.storeTransactionId,
      },
    },
    create: data,
    update: data,
  });
}

export interface ApplySubscriptionLifecycleInput {
  prisma: PrismaService;
  app: ResolvedApp;
  store: Store;
  environment: Environment;
  event: SubscriptionLifecycleEvent;
  customerId: string;
  /** The subscription row currently in the DB for this event, if any — the caller resolves this
   * (normally via `subscriptionIdentityWhere(app.projectId, store, writeIdentity)`, but Google's
   * purchaseToken-rotation case resolves it under the OLD `linkedPurchaseToken` instead — see
   * `google-ingest.service.ts`). */
  currentRow: Subscription | null;
  /** Where to WRITE the next state. Normally equal to whatever identity `currentRow` was resolved
   * by; when it differs (Google token rotation), the SAME row is re-keyed in place via
   * `update({ where: { id } })` rather than upserted under a fresh identity — never creates a
   * duplicate Subscription for the same underlying purchase. */
  writeIdentity: SubscriptionIdentity;
  ownershipType?: OwnershipType;
}

/** Runs the M4a reducer and persists its result — the read-current / apply-event / write-next half
 * of the pipeline, store-agnostic (design §4). Returns `null` (no write) when the reducer itself
 * returns `null` (a no-effect event with no existing subscription to apply it to — e.g. a stray
 * `PRICE_CHANGE`/`NO_OP` before any purchase). Throws whatever `applyLifecycleEvent` throws (a
 * state-bearing event with no prior subscription) — callers let this propagate to their own
 * journal-FAILED catch, exactly like M2b's original inline version did. */
export async function applySubscriptionLifecycle(input: ApplySubscriptionLifecycleInput): Promise<Subscription | null> {
  const { prisma, app, store, environment, event, customerId, currentRow, writeIdentity, ownershipType } = input;

  const next: SubscriptionState | null = applyLifecycleEvent(currentRow ? toSubscriptionState(currentRow) : null, event);
  if (!next) return null;

  const data = {
    ...toPersistableSubscriptionState(next),
    projectId: app.projectId,
    customerId,
    appId: app.id,
    store,
    environment,
    ...(writeIdentity.kind === 'originalTransactionId'
      ? { originalTransactionId: writeIdentity.value }
      : { purchaseToken: writeIdentity.value }),
    ...(ownershipType ? { ownershipType } : {}),
  };

  if (currentRow && !subscriptionIdentityMatches(currentRow, writeIdentity)) {
    // Google purchaseToken rotation (design §7): re-key the SAME row rather than upserting under
    // the new identity, which would create a duplicate Subscription for one underlying purchase.
    return prisma.subscription.update({ where: { id: currentRow.id }, data });
  }

  const where = subscriptionIdentityWhere(app.projectId, store, writeIdentity);
  return prisma.subscription.upsert({ where, create: data, update: data });
}

export interface PersistLifecycleEventInput {
  prisma: PrismaService;
  journal: { markProcessed(id: string): Promise<unknown>; markUnlinked(id: string): Promise<unknown> };
  journalRowId: string;
  app: ResolvedApp;
  store: Store;
  environment: Environment;
  event: SubscriptionLifecycleEvent;
  customerId: string | null;
  /** `null` when the event carries no new transaction facts (e.g. Google `ENTERED_GRACE_PERIOD` —
   * a status-only transition, no financial event, design §1.2's per-type table). */
  transactionFacts: TransactionFacts | null;
  /** `null` only for events that never touch a Subscription row (`ONE_TIME_CHARGE`; `NO_OP` never
   * reaches this far in the first place — see below). Required for every other event type; a
   * caller passing `null` here for a state-bearing event is a genuine defect, not a valid input. */
  subscriptionIdentity: SubscriptionIdentity | null;
  ownershipType?: OwnershipType;
}

/**
 * The composed, re-runnable persistence core (design §7 — this is the M2b flow M3b reuses):
 * upsert Transaction (idempotent, when facts are given) → `ONE_TIME_CHARGE` short-circuits →
 * no customer short-circuits UNLINKED → load current Subscription by identity → run
 * `applyLifecycleEvent` → upsert via `toPersistableSubscriptionState` → link the Transaction to the
 * resulting Subscription if it changed → `markProcessed`.
 *
 * Deliberately does NOT catch errors itself (M2b's original did, at the very outermost
 * `processJournaledNotification` level) — callers wrap their own call to this function in a
 * try/catch that calls `journal.markFailed`, so a defect surfaced by, e.g., a missing required
 * field for a given event type propagates exactly like it did before this was extracted.
 */
export async function persistLifecycleEvent(input: PersistLifecycleEventInput): Promise<void> {
  const { prisma, journal, journalRowId, app, store, environment, event, customerId, transactionFacts, subscriptionIdentity, ownershipType } =
    input;

  if (event.type === 'NO_OP') {
    await journal.markProcessed(journalRowId);
    return;
  }

  let persistedTransaction: Transaction | null = null;
  if (transactionFacts) {
    persistedTransaction = await upsertLifecycleTransaction({ prisma, app, store, environment, facts: transactionFacts, customerId });
  }

  if (event.type === 'ONE_TIME_CHARGE') {
    // Non-renewing/consumable — Transaction only, no Subscription row (design §2/§4).
    await journal.markProcessed(journalRowId);
    return;
  }

  if (!customerId) {
    // The Transaction (if any) is already persisted above with customerId=null; defer the
    // Subscription (its customerId is required) for a later replay once the token binds.
    await journal.markUnlinked(journalRowId);
    return;
  }

  if (!subscriptionIdentity) {
    throw new Error(
      `persistLifecycleEvent: event "${event.type}" requires a subscriptionIdentity to resolve the Subscription row`,
    );
  }

  const currentRow = await prisma.subscription.findUnique({ where: subscriptionIdentityWhere(app.projectId, store, subscriptionIdentity) });

  const subscription = await applySubscriptionLifecycle({
    prisma,
    app,
    store,
    environment,
    event,
    customerId,
    currentRow,
    writeIdentity: subscriptionIdentity,
    ownershipType,
  });

  if (subscription && persistedTransaction && persistedTransaction.subscriptionId !== subscription.id) {
    await prisma.transaction.update({ where: { id: persistedTransaction.id }, data: { subscriptionId: subscription.id } });
  }

  await journal.markProcessed(journalRowId);
}
