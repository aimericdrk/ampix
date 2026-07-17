import { Injectable } from '@nestjs/common';
import type { Environment, SubscriptionStatus } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { generateBuckets } from '../support/buckets';
import { monthlyMultiplier } from '../support/duration';
import type { MetricsQuery } from '../support/metrics.schemas';
import type {
  ActiveSubscriptionsMetrics,
  MrrMetrics,
  RevenueMetrics,
} from '../support/metrics.types';

/** Entitled subscription states — the set the entitlement engine treats as granting access. A sub
 * in one of these states counts toward active-subscriptions and MRR. */
export const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'TRIAL',
  'INTRO',
  'ACTIVE',
  'CANCELLED',
  'GRACE_PERIOD',
];

interface ActiveSubRow {
  productId: string | null;
  priceCents: number | null;
  currency: string | null;
  purchasedAt: Date;
  expiresAt: Date | null;
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /** EXACT revenue from the immutable Transaction ledger: SUM(priceCents) by date_trunc(purchasedAt),
   * scoped projectId + environment, excluding revoked (refund/chargeback) + null-price rows.
   * Per-currency totals; top-level currency/total/series report the dominant currency. */
  async revenue(projectId: string, query: MetricsQuery): Promise<RevenueMetrics> {
    const { from, to, granularity, environment } = query;

    const grouped = await this.prisma.transaction.groupBy({
      by: ['currency'],
      where: {
        projectId,
        environment,
        revokedAt: null,
        priceCents: { not: null },
        purchasedAt: { gte: from, lte: to },
      },
      _sum: { priceCents: true },
    });

    const byCurrency = grouped
      .flatMap((g) => (g.currency === null ? [] : [{ currency: g.currency, totalCents: Number(g._sum.priceCents ?? 0) }]))
      .sort((a, b) => b.totalCents - a.totalCents || a.currency.localeCompare(b.currency));

    const dominant = byCurrency[0] ?? null;
    const buckets = generateBuckets(from, to, granularity);

    let byBucket = new Map<string, number>();
    if (dominant) {
      const rows = await this.prisma.$queryRaw<{ bucket: string; amount_cents: bigint }[]>`
        SELECT to_char(date_trunc(${granularity}, purchased_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS bucket,
               SUM(price_cents)::bigint AS amount_cents
        FROM transactions
        WHERE project_id = ${projectId}::uuid
          AND environment = ${environment}::"Environment"
          AND revoked_at IS NULL
          AND price_cents IS NOT NULL
          AND currency = ${dominant.currency}
          AND purchased_at >= ${from}::timestamp
          AND purchased_at <= ${to}::timestamp
        GROUP BY 1
      `;
      byBucket = new Map(rows.map((r) => [r.bucket, Number(r.amount_cents)]));
    }

    return {
      currency: dominant?.currency ?? null,
      totalCents: dominant?.totalCents ?? 0,
      series: buckets.map((b) => ({ bucket: b.toISOString(), amountCents: byBucket.get(b.toISOString()) ?? 0 })),
      byCurrency,
    };
  }

  /** CURRENT MRR (dominant currency) = Σ monthlyCents over active subs, normalizing priceCents to a
   * monthly figure via the sub's Product.durationIso8601. Subs with no productId / unresolvable
   * period / null price are excluded and counted in unattributedActiveCount (never silently dropped).
   * Series is window-approximated (spec §0): a sub counts at bucket T when purchasedAt<=T and
   * (expiresAt IS NULL or expiresAt>T). */
  async mrr(projectId: string, query: MetricsQuery): Promise<MrrMetrics> {
    const { from, to, granularity, environment } = query;
    const subs = await this.fetchActiveSubs(projectId, environment);
    const multiplierByProduct = await this.resolveMultipliers(projectId, subs);

    let unattributedActiveCount = 0;
    const monthlyByCurrency = new Map<string, number>();
    const attributable: { monthlyCents: number; currency: string | null; purchasedAt: Date; expiresAt: Date | null }[] = [];

    for (const s of subs) {
      const multiplier = s.productId ? multiplierByProduct.get(s.productId) ?? null : null;
      if (multiplier === null || s.priceCents === null) {
        unattributedActiveCount += 1;
        continue;
      }
      const monthlyCents = Math.round(s.priceCents * multiplier);
      attributable.push({ monthlyCents, currency: s.currency, purchasedAt: s.purchasedAt, expiresAt: s.expiresAt });
      if (s.currency !== null) {
        monthlyByCurrency.set(s.currency, (monthlyByCurrency.get(s.currency) ?? 0) + monthlyCents);
      }
    }

    const dominant = pickDominantCurrency(monthlyByCurrency);
    const buckets = generateBuckets(from, to, granularity);

    return {
      currency: dominant?.currency ?? null,
      mrrCents: dominant?.total ?? 0,
      series: buckets.map((b) => {
        let sum = 0;
        if (dominant) {
          for (const a of attributable) {
            if (a.currency === dominant.currency && a.purchasedAt <= b && (a.expiresAt === null || a.expiresAt > b)) {
              sum += a.monthlyCents;
            }
          }
        }
        return { bucket: b.toISOString(), mrrCents: sum };
      }),
      unattributedActiveCount,
      approximate: true,
    };
  }

  /** Active subscribers. `current` = as of `to`; series window-approximated at each bucket start. */
  async activeSubscriptions(projectId: string, query: MetricsQuery): Promise<ActiveSubscriptionsMetrics> {
    const { from, to, granularity, environment } = query;
    const subs = await this.fetchActiveSubs(projectId, environment);
    const buckets = generateBuckets(from, to, granularity);

    return {
      current: subs.filter((s) => s.purchasedAt <= to && (s.expiresAt === null || s.expiresAt > to)).length,
      series: buckets.map((b) => ({
        bucket: b.toISOString(),
        count: subs.filter((s) => s.purchasedAt <= b && (s.expiresAt === null || s.expiresAt > b)).length,
      })),
      approximate: true,
    };
  }

  private fetchActiveSubs(projectId: string, environment: Environment): Promise<ActiveSubRow[]> {
    return this.prisma.subscription.findMany({
      where: { projectId, environment, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
      select: { productId: true, priceCents: true, currency: true, purchasedAt: true, expiresAt: true },
    });
  }

  /** Subscription has no Prisma relation to Product (productId is a bare nullable column), so resolve
   * each referenced product's period in one scoped query -> monthly multiplier (null if unresolvable). */
  private async resolveMultipliers(projectId: string, subs: ActiveSubRow[]): Promise<Map<string, number | null>> {
    const productIds = [...new Set(subs.map((s) => s.productId).filter((id): id is string => id !== null))];
    if (productIds.length === 0) return new Map();
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, projectId },
      select: { id: true, durationIso8601: true },
    });
    return new Map(products.map((p) => [p.id, monthlyMultiplier(p.durationIso8601)]));
  }
}

/** Largest total wins; ties broken alphabetically for a deterministic dominant currency. */
function pickDominantCurrency(totals: Map<string, number>): { currency: string; total: number } | null {
  let best: { currency: string; total: number } | null = null;
  for (const [currency, total] of totals) {
    if (best === null || total > best.total || (total === best.total && currency.localeCompare(best.currency) < 0)) {
      best = { currency, total };
    }
  }
  return best;
}
