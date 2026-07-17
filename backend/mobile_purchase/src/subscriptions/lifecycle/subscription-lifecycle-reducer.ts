import type {
  InitialPurchaseEvent,
  RefundReversedEvent,
  SubscriptionLifecycleEvent,
  SubscriptionState,
} from './subscription-lifecycle.types';

/** Statuses only a fresh purchase (both) or `REFUND_REVERSED` (REVOKED only) may move out of —
 * design's "Terminal-state discipline" (§4: "any state ── REFUND/REVOKE ──▶ REVOKED", "→ expired:
 * expiry notification ... compute-on-read"). */
const TERMINAL_STATUSES: ReadonlySet<SubscriptionState['status']> = new Set(['EXPIRED', 'REVOKED']);

/** Event types with NO `SubscriptionState` field effect at all (design §2/§4: `PRICE_CHANGE` has
 * no column to record consent state in; `ONE_TIME_CHARGE` is Transaction-only; `NO_OP` is
 * explicitly a no-effect journal entry). Uniform invariant: an event that changes no state field
 * returns `current` completely UNCHANGED — including `lastEventAt` — on both terminal and
 * non-terminal states. This replaces an earlier "seen it, so advance the ordering high-water mark
 * anyway" rule: that rule let a newer no-op event (e.g. an out-of-order `PRICE_CHANGE`) bump
 * `lastEventAt` past an older real transition (e.g. `AUTO_RENEW_DISABLED`) still in flight, causing
 * the ordering guard to silently drop the real transition when it arrived. Only events that mutate
 * a state field may advance `lastEventAt`. */
const NO_EFFECT_EVENT_TYPES: ReadonlySet<SubscriptionLifecycleEvent['type']> = new Set([
  'NO_OP',
  'PRICE_CHANGE',
  'ONE_TIME_CHARGE',
]);

/**
 * The pure subscription lifecycle reducer (design §4). Applies one normalized
 * `SubscriptionLifecycleEvent` to the subscription's current mutable state and returns the next
 * state. Deterministic and I/O-free: every timestamp it uses comes from the event itself, never
 * from a wall clock — `now`-relative derivations (`isActive`, `willRenew`) are M4b's job on read,
 * not this reducer's on write.
 *
 * @param current the subscription's current lifecycle state, or `null` if this is the first event
 *   seen for this store-subscription identity (M2/M3 resolve identity — this function trusts the
 *   caller's null/non-null choice).
 * @param event the normalized event — see `apple-notification-mapper.ts` /
 *   `google-notification-mapper.ts` for how store payloads become one of these.
 * @returns the next state, or `null` when `current` is `null` and `event` has no state-bearing
 *   effect (`NO_OP`/`PRICE_CHANGE`/`ONE_TIME_CHARGE`) — still no subscription, not an error. M2/M3
 *   may instead choose to synthesize an `INITIAL_PURCHASE` from a self-contained Apple notification
 *   when no subscription exists yet (RC-style backfill) rather than route such events through here.
 * @throws if `current` is `null` and `event` is state-bearing but cannot originate a subscription
 *   (only `INITIAL_PURCHASE` can) — treated as a caller/identity-resolution defect; M2/M3 should
 *   journal `FAILED` and replay rather than swallow this.
 */
export function applyLifecycleEvent(current: SubscriptionState, event: SubscriptionLifecycleEvent): SubscriptionState;
export function applyLifecycleEvent(current: null, event: InitialPurchaseEvent): SubscriptionState;
export function applyLifecycleEvent(current: null, event: SubscriptionLifecycleEvent): SubscriptionState | null;
// The "row-or-null loaded from Postgres" shape M2/M3 hold: a state-bearing event throws only when
// `current` is null (handled inside), so the return is `SubscriptionState | null`.
export function applyLifecycleEvent(
  current: SubscriptionState | null,
  event: SubscriptionLifecycleEvent,
): SubscriptionState | null;
export function applyLifecycleEvent(
  current: SubscriptionState | null,
  event: SubscriptionLifecycleEvent,
): SubscriptionState | null {
  if (current === null) {
    if (event.type === 'INITIAL_PURCHASE') {
      return createInitialState(event);
    }
    if (NO_EFFECT_EVENT_TYPES.has(event.type)) {
      return null;
    }
    throw new Error(
      `applyLifecycleEvent: cannot apply "${event.type}" with no existing subscription state — only INITIAL_PURCHASE can create one`,
    );
  }

  // Ordering guard (design §7): a payload older than what's already applied is a stale/
  // out-of-order delivery — no-op, current is returned completely untouched (lastEventAt too).
  if (event.occurredAt.getTime() < current.lastEventAt.getTime()) {
    return current;
  }

  // Terminal-state discipline: once REVOKED/EXPIRED, only the two documented reversals apply.
  if (TERMINAL_STATUSES.has(current.status)) {
    if (event.type === 'INITIAL_PURCHASE') {
      return createInitialState(event);
    }
    if (event.type === 'REFUND_REVERSED' && current.status === 'REVOKED') {
      return restoreFromRevoke(current, event) ?? bumpLastEventAt(current, event.occurredAt);
    }
    if (NO_EFFECT_EVENT_TYPES.has(event.type)) {
      return current;
    }
    return bumpLastEventAt(current, event.occurredAt);
  }

  switch (event.type) {
    case 'INITIAL_PURCHASE':
      // A fresh purchase always starts a brand-new lifecycle, discarding whatever came before —
      // covers Apple SUBSCRIBED/RESUBSCRIBE and Google PURCHASED(4) landing on a still-live row.
      return createInitialState(event);

    case 'RENEWED':
      // Design §4 "trial → active": any successful renewal yields the paid, NORMAL period, and a
      // renewal charge succeeding implies any prior billing issue is resolved.
      // M1 (documented, not fixed here): always yields NORMAL even for a multi-period intro offer
      // (e.g. a 3-month intro price billed monthly) — the remaining intro periods are lost after
      // the first renewal charge. Accepted per the design table's literal reading; a future
      // increment could carry the intro-periods-remaining count through `RenewedEvent` if product
      // needs it preserved.
      return {
        ...current,
        status: 'ACTIVE',
        periodType: 'NORMAL',
        storeProductId: event.storeProductId,
        expiresAt: event.expiresAt,
        autoRenewStatus: event.autoRenewStatus ?? current.autoRenewStatus,
        billingIssueDetectedAt: null,
        gracePeriodExpiresAt: null,
        lastEventAt: event.occurredAt,
      };

    case 'BILLING_RECOVERED':
      return {
        ...current,
        status: 'ACTIVE',
        expiresAt: event.expiresAt ?? current.expiresAt,
        billingIssueDetectedAt: null,
        gracePeriodExpiresAt: null,
        lastEventAt: event.occurredAt,
      };

    case 'AUTO_RENEW_DISABLED':
      // RC-fidelity: cancellation does NOT remove access — CANCELLED stays entitled until
      // expiresAt (left untouched here); only the renewal intent and its timestamp change.
      return {
        ...current,
        status: 'CANCELLED',
        autoRenewStatus: false,
        unsubscribeDetectedAt: event.occurredAt,
        lastEventAt: event.occurredAt,
      };

    case 'AUTO_RENEW_ENABLED':
      // M2 (documented, not fixed here): forces status ACTIVE even if periodType is still TRIAL
      // (e.g. re-enabling auto-renew mid-trial) — followed the design table literally per the
      // brief's "use the exact values/semantics verbatim" instruction rather than second-guessing;
      // a TRIAL sub re-enabling arguably ought to stay TRIAL until it actually converts.
      return {
        ...current,
        status: 'ACTIVE',
        autoRenewStatus: true,
        unsubscribeDetectedAt: null,
        lastEventAt: event.occurredAt,
      };

    case 'PRODUCT_CHANGE_IMMEDIATE':
      // Upgrade/crossgrade effective now — supersedes any pending downgrade.
      return {
        ...current,
        status: 'ACTIVE',
        periodType: 'NORMAL',
        storeProductId: event.storeProductId,
        purchasedAt: event.purchasedAt,
        expiresAt: event.expiresAt,
        autoRenewProductId: null,
        billingIssueDetectedAt: null,
        gracePeriodExpiresAt: null,
        lastEventAt: event.occurredAt,
      };

    case 'PRODUCT_CHANGE_SCHEDULED':
      // Downgrade: pending only, applied at next renewal — no other field changes today.
      return {
        ...current,
        autoRenewProductId: event.autoRenewProductId,
        lastEventAt: event.occurredAt,
      };

    case 'ENTERED_GRACE_PERIOD':
      // Still entitled during grace (RC-fidelity check).
      return {
        ...current,
        status: 'GRACE_PERIOD',
        billingIssueDetectedAt: event.occurredAt,
        gracePeriodExpiresAt: event.gracePeriodExpiresAt,
        lastEventAt: event.occurredAt,
      };

    case 'ENTERED_BILLING_RETRY':
      // NOT entitled, no grace window (RC-fidelity check) — clear any stale grace date.
      return {
        ...current,
        status: 'BILLING_RETRY',
        billingIssueDetectedAt: event.occurredAt,
        gracePeriodExpiresAt: null,
        lastEventAt: event.occurredAt,
      };

    case 'GRACE_PERIOD_EXPIRED':
      // Grace ended, store still retrying, access now off.
      return {
        ...current,
        status: 'BILLING_RETRY',
        lastEventAt: event.occurredAt,
      };

    case 'EXPIRED':
      return {
        ...current,
        status: 'EXPIRED',
        lastEventAt: event.occurredAt,
      };

    case 'PAUSED':
      // Google-only: not entitled, but willRenew stays true (design §1.2 row 10).
      return {
        ...current,
        status: 'PAUSED',
        autoRenewStatus: true,
        lastEventAt: event.occurredAt,
      };

    case 'RESUMED':
      return {
        ...current,
        status: 'ACTIVE',
        expiresAt: event.expiresAt ?? current.expiresAt,
        lastEventAt: event.occurredAt,
      };

    case 'REVOKED':
      // Immediate loss of access, regardless of prior status. Deliberately NO snapshot — a later
      // REFUND_REVERSED recomputes the restored state from that event's own authoritative fields
      // (see restoreFromRevoke), not from anything captured here. The other lifecycle fields
      // (expiresAt, autoRenewStatus, periodType, ...) are left as-is: they're still the last-known
      // store facts and are harmless while status = REVOKED (compute-on-read / M4b treats REVOKED
      // as not-entitled regardless of what these fields say).
      return {
        ...current,
        status: 'REVOKED',
        refundedAt: event.revokedAt ?? event.occurredAt,
        lastEventAt: event.occurredAt,
      };

    case 'REFUND_REVERSED':
      // Reached here only when current.status !== 'REVOKED' (the REVOKED case is fully handled by
      // the terminal-state branch above) — i.e. a reversal with nothing to reverse: no-op. Bumps
      // lastEventAt (this event was legitimately seen and decided to have no effect) — distinct
      // from NO_OP/PRICE_CHANGE/ONE_TIME_CHARGE, which never have a state effect regardless of
      // current status.
      return restoreFromRevoke(current, event) ?? bumpLastEventAt(current, event.occurredAt);

    case 'RENEWAL_EXTENDED':
      // Dev-granted / deferred extension — extends expiresAt only, no status change.
      return {
        ...current,
        expiresAt: event.expiresAt,
        lastEventAt: event.occurredAt,
      };

    case 'PRICE_CHANGE':
      // Informational (consent state / confirmed price) — no SubscriptionState field to record it
      // in (design §2 scopes priceCents/currency to Transaction, not Subscription). No state
      // effect at all (I1): returns current verbatim, lastEventAt included — see
      // NO_EFFECT_EVENT_TYPES.
      return current;

    case 'OFFER_REDEEMED':
      return {
        ...current,
        storeProductId: event.storeProductId ?? current.storeProductId,
        periodType: event.periodType ?? current.periodType,
        expiresAt: event.expiresAt ?? current.expiresAt,
        lastEventAt: event.occurredAt,
      };

    case 'ONE_TIME_CHARGE':
      // Non-renewing/consumable — no Subscription row effect (design §2/§4); M2/M3 should route
      // these straight to Transaction creation and not call this reducer at all in practice. No
      // state effect at all (I1): returns current verbatim, lastEventAt included.
      return current;

    case 'NO_OP':
      // Explicit no-effect event (I1): returns current verbatim, lastEventAt included.
      return current;

    default:
      return assertNever(event);
  }
}

function createInitialState(event: InitialPurchaseEvent): SubscriptionState {
  const status: SubscriptionState['status'] =
    event.periodType === 'TRIAL' ? 'TRIAL' : event.periodType === 'INTRO' ? 'INTRO' : 'ACTIVE';
  return {
    status,
    expiresAt: event.expiresAt,
    autoRenewStatus: event.autoRenewStatus,
    autoRenewProductId: event.autoRenewProductId ?? null,
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    gracePeriodExpiresAt: null,
    refundedAt: null,
    periodType: event.periodType,
    lastEventAt: event.occurredAt,
    storeProductId: event.storeProductId,
    purchasedAt: event.purchasedAt,
    originalPurchasedAt: event.originalPurchasedAt ?? event.purchasedAt,
  };
}

/**
 * Recomputes the subscription's restored state from `REFUND_REVERSED`'s own authoritative fields
 * — RC-faithful: RC re-reads the full authoritative transaction+renewal info from each
 * self-contained notification rather than depending on an in-memory snapshot to reverse a refund
 * (C1 fix). `current` must be the CURRENT state as loaded (e.g. from Postgres by M2/M3) — it may
 * have no relation whatsoever to whatever the reducer saw in-memory before the revoke.
 *
 * Reference time is `event.occurredAt` (the notification's own signed time), NEVER `Date.now()` —
 * this reducer is deterministic and I/O-free.
 *
 * Returns `null` when there is nothing to restore (`current.status !== 'REVOKED'`).
 */
function restoreFromRevoke(current: SubscriptionState, event: RefundReversedEvent): SubscriptionState | null {
  if (current.status !== 'REVOKED') return null;

  const { occurredAt, expiresAt, autoRenewStatus } = event;
  const status: SubscriptionState['status'] =
    expiresAt !== null && expiresAt.getTime() <= occurredAt.getTime()
      ? 'EXPIRED'
      : autoRenewStatus === false
        ? 'CANCELLED' // entitled until expiry, not renewing
        : 'ACTIVE';

  return {
    ...current,
    status,
    expiresAt,
    autoRenewStatus,
    refundedAt: null, // a reversed refund is a healthy sub
    billingIssueDetectedAt: null,
    gracePeriodExpiresAt: null,
    lastEventAt: occurredAt,
  };
}

function bumpLastEventAt(current: SubscriptionState, occurredAt: Date): SubscriptionState {
  return { ...current, lastEventAt: occurredAt };
}

function assertNever(value: never): never {
  throw new Error(`applyLifecycleEvent: unhandled event type ${JSON.stringify(value)}`);
}
