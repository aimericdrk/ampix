import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Subscription } from '../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  applySubscriptionLifecycle,
  type SubscriptionIdentity,
} from '../webhooks/shared/persist-lifecycle-event';

/** Advisory-lock key for the expiry sweep — a fixed application-chosen bigint so overlapping sweeps
 * (same instance, or a future second Cloud Run instance) serialize on `pg_try_advisory_xact_lock`. */
export const EXPIRY_SWEEP_LOCK_KEY = 824642001;
/** Rows loaded per batch transaction. */
export const EXPIRY_SWEEP_BATCH_SIZE = 500;
/** Hard cap on batches per run — bounds a single sweep; the next cron tick continues. */
export const EXPIRY_SWEEP_MAX_BATCHES = 20;

export interface ExpirySweepResult {
  candidates: number;
  expired: number;
  skippedLock: boolean;
  batches: number;
  capped: boolean;
}

/**
 * Flips still-entitled-looking subscriptions to EXPIRED once their effective expiry passes, THROUGH
 * the lifecycle reducer (design §2) — one writer of subscription state. The store call is not
 * involved; this is an internally-originated transition. Idempotent (upsert-by-identity through a
 * terminal-safe reducer) and safe under concurrency (advisory try-lock per batch).
 */
@Injectable()
export class SubscriptionExpirySweepService {
  private readonly logger = new Logger(SubscriptionExpirySweepService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sweep(
    nowMs: number = Date.now(),
    opts: { batchSize?: number; maxBatches?: number } = {},
  ): Promise<ExpirySweepResult> {
    const now = new Date(nowMs);
    const batchSize = opts.batchSize ?? EXPIRY_SWEEP_BATCH_SIZE;
    const maxBatches = opts.maxBatches ?? EXPIRY_SWEEP_MAX_BATCHES;
    const result: ExpirySweepResult = { candidates: 0, expired: 0, skippedLock: false, batches: 0, capped: false };

    for (let batchNo = 0; batchNo < maxBatches; batchNo++) {
      let outcome: { skippedLock: true } | { skippedLock: false; count: number; expired: number };
      try {
        outcome = await this.runBatch(now, batchSize);
      } catch (error) {
        // A batch transaction aborts atomically on any error; the run ends with the counts so far
        // and the next cron tick retries (the sweep is idempotent). See the plan's §2 note.
        this.logger.error(
          `expiry sweep batch ${batchNo} failed: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        break;
      }

      if (outcome.skippedLock) {
        result.skippedLock = true;
        break;
      }

      result.batches++;
      result.candidates += outcome.count;
      result.expired += outcome.expired;

      if (outcome.count < batchSize) break; // drained
      if (batchNo === maxBatches - 1) result.capped = true;
    }

    return result;
  }

  /** One lock-guarded batch: try the advisory lock, load up to `batchSize` candidates, expire each
   * through the reducer. All in one transaction so the xact lock protects the writes. */
  private runBatch(
    now: Date,
    batchSize: number,
  ): Promise<{ skippedLock: true } | { skippedLock: false; count: number; expired: number }> {
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(${EXPIRY_SWEEP_LOCK_KEY}::bigint) AS locked`,
      );
      if (lock[0]?.locked !== true) {
        return { skippedLock: true as const };
      }

      // Productive candidates only: rows the reducer will ACTUALLY expire. Column-to-column
      // comparisons (`last_event_at <= COALESCE(grace_period_expires_at, expires_at)`) aren't
      // expressible in a Prisma `where`, hence the raw id-selection. Two failure modes this
      // guards against: a row with neither identity column throws out of `writeIdentityOf` and
      // aborts the whole batch transaction; and a "superseded" row (already advanced past its own
      // expiry by a later real event) matches the old status/expiry-only predicate forever, so at
      // scale it would keep consuming the `maxBatches` cap while never actually expiring. A NULL
      // `last_event_at` is coalesced to `-infinity` (never-superseded) so it stays eligible —
      // matching the reducer's own `new Date(0)` fallback in `to-subscription-state.ts`, rather than
      // SQL three-valued logic silently excluding it (the same starvation class this guards against).
      const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM subscriptions
        WHERE (
          (status IN ('TRIAL','INTRO','ACTIVE','CANCELLED') AND expires_at IS NOT NULL AND expires_at <= ${now})
          OR (status = 'GRACE_PERIOD' AND grace_period_expires_at IS NOT NULL AND grace_period_expires_at <= ${now})
          OR (status = 'GRACE_PERIOD' AND grace_period_expires_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ${now})
        )
        AND (original_transaction_id IS NOT NULL OR purchase_token IS NOT NULL)
        AND COALESCE(last_event_at, '-infinity') <= COALESCE(grace_period_expires_at, expires_at)
        ORDER BY COALESCE(grace_period_expires_at, expires_at) ASC
        LIMIT ${batchSize}
      `);
      const candidates = ids.length
        ? await tx.subscription.findMany({ where: { id: { in: ids.map((r) => r.id) } } })
        : [];

      let expired = 0;
      for (const row of candidates) {
        const next = await applySubscriptionLifecycle({
          prisma: tx as unknown as PrismaService,
          app: { id: row.appId, projectId: row.projectId },
          store: row.store,
          environment: row.environment,
          event: { type: 'EXPIRED', occurredAt: effectiveExpiry(row) },
          customerId: row.customerId,
          currentRow: row,
          writeIdentity: writeIdentityOf(row),
        });
        if (next?.status === 'EXPIRED') expired++;
      }

      return { skippedLock: false as const, count: candidates.length, expired };
    });
  }
}

/** The row's own expiry instant — grace rows use gracePeriodExpiresAt when set, else expiresAt.
 * The raw-SQL productive predicate in `runBatch` guarantees the chosen field is non-null. */
function effectiveExpiry(row: Subscription): Date {
  if (row.status === 'GRACE_PERIOD' && row.gracePeriodExpiresAt) return row.gracePeriodExpiresAt;
  // Non-null by the productive predicate.
  return row.expiresAt as Date;
}

/** The row's per-store write identity — Apple by originalTransactionId, Google by purchaseToken. */
function writeIdentityOf(row: Subscription): SubscriptionIdentity {
  if (row.originalTransactionId) return { kind: 'originalTransactionId', value: row.originalTransactionId };
  if (row.purchaseToken) return { kind: 'purchaseToken', value: row.purchaseToken };
  throw new Error(`subscription ${row.id} has neither originalTransactionId nor purchaseToken`);
}
