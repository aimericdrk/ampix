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

/** Statuses that are still-entitled-looking and thus sweepable once their effective expiry passes
 * (design §0). BILLING_RETRY/PAUSED/EXPIRED/REVOKED are deliberately excluded. */
const SWEEPABLE_VIA_EXPIRES_AT = ['TRIAL', 'INTRO', 'ACTIVE', 'CANCELLED'] as const;

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

      const candidates = await tx.subscription.findMany({
        where: candidateWhere(now),
        take: batchSize,
      });

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

/** Candidate predicate (design §2): effective expiry ≤ now, still-entitled-looking status. */
function candidateWhere(now: Date): Prisma.SubscriptionWhereInput {
  return {
    OR: [
      { status: { in: [...SWEEPABLE_VIA_EXPIRES_AT] }, expiresAt: { not: null, lte: now } },
      { status: 'GRACE_PERIOD', gracePeriodExpiresAt: { not: null, lte: now } },
      { status: 'GRACE_PERIOD', gracePeriodExpiresAt: null, expiresAt: { not: null, lte: now } },
    ],
  };
}

/** The row's own expiry instant — grace rows use gracePeriodExpiresAt when set, else expiresAt.
 * `candidateWhere` guarantees the chosen field is non-null. */
function effectiveExpiry(row: Subscription): Date {
  if (row.status === 'GRACE_PERIOD' && row.gracePeriodExpiresAt) return row.gracePeriodExpiresAt;
  // Non-null by the candidate predicate.
  return row.expiresAt as Date;
}

/** The row's per-store write identity — Apple by originalTransactionId, Google by purchaseToken. */
function writeIdentityOf(row: Subscription): SubscriptionIdentity {
  if (row.originalTransactionId) return { kind: 'originalTransactionId', value: row.originalTransactionId };
  if (row.purchaseToken) return { kind: 'purchaseToken', value: row.purchaseToken };
  throw new Error(`subscription ${row.id} has neither originalTransactionId nor purchaseToken`);
}
