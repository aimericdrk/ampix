import { Injectable } from '@nestjs/common';
import type { Environment } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { generateBuckets, nextBucket } from '../support/buckets';
import { monthlyMultiplier } from '../support/duration';
import type { MetricsQuery } from '../support/metrics.schemas';
import type {
  MrrMovementBucket,
  MrrMovementMetrics,
  MrrMovementTotals,
} from '../support/mrr-movement.types';

/** Fields we need to place a subscription's MRR on the timeline and classify its movement. */
interface MovementSubRow {
  id: string;
  productId: string | null;
  priceCents: number | null;
  currency: string | null;
  purchasedAt: Date;
  originalPurchasedAt: Date | null;
  expiresAt: Date | null;
  refundedAt: Date | null;
}

/** A price-bearing transaction, used to recover a sub's effective price *as of* a boundary (so a
 *  mid-life price change reads as expansion/contraction, not as churn+new). */
interface MovementTxRow {
  subscriptionId: string | null;
  priceCents: number | null;
  purchasedAt: Date;
  revokedAt: Date | null;
}

/**
 * Computes MRR movement (new / reactivation / expansion / contraction / churn / net) per bucket.
 *
 * Method — window-boundary decomposition. A subscription is "active at instant T" when
 * `purchasedAt <= T`, it hasn't expired (`expiresAt` null or `> T`), and it hasn't been refunded
 * (`refundedAt` null or `> T`) — the same window approximation the MRR series uses, but WITHOUT the
 * active-status filter, so subs that have since expired still count as churn at the boundary they
 * lapsed. For each bucket `[prev, cur)` and each subscription we compare its monthly MRR contribution
 * at `prev` vs `cur`:
 *   - 0 → +m : a gain. Reactivation if the sub had an earlier lifecycle
 *              (`originalPurchasedAt < purchasedAt`), otherwise New.
 *   - +m → 0 : churn (−m).
 *   - +a → +b (a≠b) : expansion (+Δ) or contraction (−Δ).
 * The effective price at a boundary comes from the sub's latest non-revoked, price-bearing
 * transaction on or before that boundary (falling back to the sub's current price when it has no
 * transaction history), so a renewal at a different price shows up as expansion/contraction rather
 * than a churn+new pair. All amounts are normalized to a monthly figure via the product's
 * ISO-8601 duration and reported in the single dominant currency. `approximate: true` for the same
 * reason the MRR series is: it is a boundary snapshot, not an event-sourced ledger.
 */
@Injectable()
export class MrrMovementService {
  constructor(private readonly prisma: PrismaService) {}

  async mrrMovement(projectId: string, query: MetricsQuery): Promise<MrrMovementMetrics> {
    const { from, to, granularity, environment } = query;

    const bucketStarts = generateBuckets(from, to, granularity);
    // Boundaries we evaluate the active set at: each bucket start plus the end of the last bucket.
    const firstBoundary = bucketStarts[0] ?? from;
    const lastBoundary = bucketStarts.length
      ? nextBucket(bucketStarts[bucketStarts.length - 1], granularity)
      : to;

    const subs = await this.fetchSubs(projectId, environment, firstBoundary, lastBoundary);
    const multiplierByProduct = await this.resolveMultipliers(projectId, subs);
    const txBySub = await this.fetchTransactionsBySub(projectId, environment, subs);

    // Keep only subs with a resolvable monthly MRR (product period + price + currency). Others are
    // "unattributed" and, exactly as in the MRR series, contribute no movement rather than being
    // silently counted at a wrong value.
    const attributable = subs.flatMap((s) => {
      const multiplier = s.productId ? multiplierByProduct.get(s.productId) ?? null : null;
      if (multiplier === null || s.priceCents === null || s.currency === null) return [];
      return [{ sub: s, multiplier, currency: s.currency }];
    });

    const currency = pickDominantCurrency(attributable);
    const inCurrency = attributable.filter((a) => a.currency === currency);

    const buckets: MrrMovementBucket[] = bucketStarts.map((prev, i) => {
      const cur = i + 1 < bucketStarts.length ? bucketStarts[i + 1] : lastBoundary;
      const b: MrrMovementBucket = {
        bucket: prev.toISOString(),
        new_cents: 0,
        reactivation_cents: 0,
        expansion_cents: 0,
        contraction_cents: 0,
        churn_cents: 0,
        net_cents: 0,
      };
      for (const { sub, multiplier } of inCurrency) {
        const cp = this.effectiveMonthly(sub, prev, multiplier, txBySub.get(sub.id));
        const cc = this.effectiveMonthly(sub, cur, multiplier, txBySub.get(sub.id));
        if (cp === 0 && cc > 0) {
          const reactivation =
            sub.originalPurchasedAt !== null && sub.originalPurchasedAt.getTime() < sub.purchasedAt.getTime();
          if (reactivation) b.reactivation_cents += cc;
          else b.new_cents += cc;
        } else if (cp > 0 && cc === 0) {
          b.churn_cents -= cp;
        } else if (cp > 0 && cc > 0 && cc !== cp) {
          const delta = cc - cp;
          if (delta > 0) b.expansion_cents += delta;
          else b.contraction_cents += delta;
        }
      }
      b.net_cents =
        b.new_cents + b.reactivation_cents + b.expansion_cents + b.contraction_cents + b.churn_cents;
      return b;
    });

    return { currency, buckets, totals: sumTotals(buckets), approximate: true };
  }

  /** Monthly MRR this sub contributes at instant `T` (0 when not active at `T`). Price is the sub's
   *  latest non-revoked, price-bearing transaction on or before `T`, else its current price. */
  private effectiveMonthly(
    sub: MovementSubRow,
    at: Date,
    multiplier: number,
    txns: MovementTxRow[] | undefined,
  ): number {
    const activeAt =
      sub.purchasedAt.getTime() <= at.getTime() &&
      (sub.expiresAt === null || sub.expiresAt.getTime() > at.getTime()) &&
      (sub.refundedAt === null || sub.refundedAt.getTime() > at.getTime());
    if (!activeAt) return 0;

    let priceCents = sub.priceCents; // fallback: current price (no transaction history)
    if (txns && txns.length) {
      // txns are sorted ascending by purchasedAt; take the latest in effect at `at`.
      for (const tx of txns) {
        if (tx.purchasedAt.getTime() > at.getTime()) break;
        if (tx.revokedAt !== null && tx.revokedAt.getTime() <= at.getTime()) continue;
        if (tx.priceCents !== null) priceCents = tx.priceCents;
      }
    }
    if (priceCents === null) return 0;
    return Math.round(priceCents * multiplier);
  }

  /** Subs that could be active at any evaluated boundary: started on or before the last boundary and
   *  not already lapsed before the first (any status — churned subs are needed to detect churn). */
  private fetchSubs(
    projectId: string,
    environment: Environment,
    firstBoundary: Date,
    lastBoundary: Date,
  ): Promise<MovementSubRow[]> {
    return this.prisma.subscription.findMany({
      where: {
        projectId,
        environment,
        purchasedAt: { lte: lastBoundary },
        OR: [{ expiresAt: null }, { expiresAt: { gt: firstBoundary } }],
      },
      select: {
        id: true,
        productId: true,
        priceCents: true,
        currency: true,
        purchasedAt: true,
        originalPurchasedAt: true,
        expiresAt: true,
        refundedAt: true,
      },
    });
  }

  /** Subscription has no Prisma relation to Product; resolve each period → monthly multiplier once. */
  private async resolveMultipliers(
    projectId: string,
    subs: MovementSubRow[],
  ): Promise<Map<string, number | null>> {
    const productIds = [...new Set(subs.map((s) => s.productId).filter((id): id is string => id !== null))];
    if (productIds.length === 0) return new Map();
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, projectId },
      select: { id: true, durationIso8601: true },
    });
    return new Map(products.map((p) => [p.id, monthlyMultiplier(p.durationIso8601)]));
  }

  /** Price-bearing transactions for these subs, grouped by subscription and sorted ascending. */
  private async fetchTransactionsBySub(
    projectId: string,
    environment: Environment,
    subs: MovementSubRow[],
  ): Promise<Map<string, MovementTxRow[]>> {
    const subIds = subs.map((s) => s.id);
    if (subIds.length === 0) return new Map();
    const txns = (await this.prisma.transaction.findMany({
      where: { projectId, environment, isTrialPeriod: false, priceCents: { not: null }, subscriptionId: { in: subIds } },
      select: { subscriptionId: true, priceCents: true, purchasedAt: true, revokedAt: true },
      orderBy: { purchasedAt: 'asc' },
    })) as MovementTxRow[];
    const bySub = new Map<string, MovementTxRow[]>();
    for (const tx of txns) {
      if (tx.subscriptionId === null) continue;
      const list = bySub.get(tx.subscriptionId);
      if (list) list.push(tx);
      else bySub.set(tx.subscriptionId, [tx]);
    }
    return bySub;
  }
}

/** Dominant currency = the one with the largest total monthly MRR across the window's attributable
 *  subs (ties broken A→Z). Independent of the window endpoints, so a churn-only window still reports
 *  its currency instead of dropping every movement. */
function pickDominantCurrency(
  attributable: { sub: MovementSubRow; multiplier: number; currency: string }[],
): string | null {
  const totals = new Map<string, number>();
  for (const { sub, multiplier, currency } of attributable) {
    if (sub.priceCents === null) continue;
    totals.set(currency, (totals.get(currency) ?? 0) + Math.round(sub.priceCents * multiplier));
  }
  let best: { currency: string; total: number } | null = null;
  for (const [currency, total] of totals) {
    if (best === null || total > best.total || (total === best.total && currency.localeCompare(best.currency) < 0)) {
      best = { currency, total };
    }
  }
  return best?.currency ?? null;
}

function sumTotals(buckets: MrrMovementBucket[]): MrrMovementTotals {
  const t: MrrMovementTotals = {
    new_cents: 0,
    reactivation_cents: 0,
    expansion_cents: 0,
    contraction_cents: 0,
    churn_cents: 0,
    net_cents: 0,
  };
  for (const b of buckets) {
    t.new_cents += b.new_cents;
    t.reactivation_cents += b.reactivation_cents;
    t.expansion_cents += b.expansion_cents;
    t.contraction_cents += b.contraction_cents;
    t.churn_cents += b.churn_cents;
    t.net_cents += b.net_cents;
  }
  return t;
}
