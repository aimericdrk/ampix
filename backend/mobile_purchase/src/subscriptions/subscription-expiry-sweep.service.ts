import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
 * Flips still-entitled-looking subscriptions to EXPIRED once their expiry passes, THROUGH the
 * lifecycle reducer (design §2). D2.1 ships this as a stub so the scheduler wiring compiles and
 * lands first; D2.2 implements `sweep`.
 */
@Injectable()
export class SubscriptionExpirySweepService {
  constructor(private readonly prisma: PrismaService) {}

  async sweep(
    nowMs: number = Date.now(),
    opts: { batchSize?: number; maxBatches?: number } = {},
  ): Promise<ExpirySweepResult> {
    // D2.2 implements the real sweep. Stub returns a clean no-op so D2.1's wiring is testable.
    // `void` marks the params/field as intentionally unused here (tsc `noUnusedParameters` +
    // eslint clean) — all three are used by D2.2's implementation.
    void nowMs;
    void opts;
    void this.prisma;
    return { candidates: 0, expired: 0, skippedLock: false, batches: 0, capped: false };
  }
}
