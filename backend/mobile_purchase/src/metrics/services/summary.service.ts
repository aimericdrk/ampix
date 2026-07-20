import { Injectable } from '@nestjs/common';
import type { Environment, PeriodType, Store, SubscriptionStatus } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { generateBuckets, truncateUtc } from '../support/buckets';
import { monthlyMultiplier } from '../support/duration';
import type { MetricsQuery } from '../support/metrics.schemas';
import type {
  ChurnReasonCount,
  SubscriptionRecentEvent,
  SubscriptionsByDay,
  SubscriptionsByProduct,
  SubscriptionsByStore,
  SubscriptionsSummaryResponse,
} from '../support/summary.types';
import { ACTIVE_SUBSCRIPTION_STATUSES, MetricsService } from './metrics.service';

const RECENT_EVENTS_LIMIT = 20;

interface ActiveAsOfToRow {
  productId: string | null;
  storeProductId: string;
  store: Store;
  status: SubscriptionStatus;
  periodType: PeriodType;
  priceCents: number | null;
  currency: string | null;
}

interface ChurnedSubRow {
  billingIssueDetectedAt: Date | null;
  unsubscribeDetectedAt: Date | null;
  refundedAt: Date | null;
  expiresAt: Date | null;
}

interface SubInRangeRow {
  purchasedAt: Date;
  periodType: PeriodType;
}

interface RevenueTxRow {
  priceCents: number | null;
  purchasedAt: Date;
}

interface RecentTxRow {
  id: string;
  customerId: string | null;
  storeProductId: string;
  priceCents: number | null;
  purchasedAt: Date;
  revokedAt: Date | null;
  originalTransactionId: string | null;
  storeTransactionId: string;
}

/**
 * Assembles the RC Overview `SubscriptionsSummaryResponse` (design §1.2): current-state KPIs
 * (mrr_cents/active) reuse `MetricsService.mrr`/`activeSubscriptions`; everything else is computed
 * directly from Subscription/Transaction rows, window-approximated like the rest of the metrics
 * slice (design §0).
 */
@Injectable()
export class SummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async summary(projectId: string, query: MetricsQuery): Promise<SubscriptionsSummaryResponse> {
    const { from, to, environment } = query;

    const [mrrResult, activeResult, activeAsOfTo, subsInRange, churnedSubs, convertedCandidates, revenueTx, recentTx] =
      await Promise.all([
        this.metrics.mrr(projectId, query),
        this.metrics.activeSubscriptions(projectId, query),
        this.fetchActiveAsOfTo(projectId, environment, to),
        this.prisma.subscription.findMany({
          where: { projectId, environment, purchasedAt: { gte: from, lte: to } },
          select: { purchasedAt: true, periodType: true },
        }) as Promise<SubInRangeRow[]>,
        this.fetchChurnedInRange(projectId, environment, from, to),
        this.prisma.subscription.findMany({
          where: {
            projectId,
            environment,
            periodType: 'NORMAL',
            status: { in: ACTIVE_SUBSCRIPTION_STATUSES },
            purchasedAt: { gte: from, lte: to },
          },
          select: { id: true },
        }),
        this.prisma.transaction.findMany({
          where: { projectId, environment, revokedAt: null, priceCents: { not: null }, purchasedAt: { gte: from, lte: to } },
          select: { priceCents: true, purchasedAt: true },
        }) as Promise<RevenueTxRow[]>,
        this.prisma.transaction.findMany({
          where: { projectId, environment, purchasedAt: { gte: from, lte: to } },
          orderBy: { purchasedAt: 'desc' },
          take: RECENT_EVENTS_LIMIT,
          select: {
            id: true, customerId: true, storeProductId: true, priceCents: true,
            purchasedAt: true, revokedAt: true, originalTransactionId: true, storeTransactionId: true,
          },
        }) as Promise<RecentTxRow[]>,
      ]);

    const trials_converted = await this.countConvertedTrials(convertedCandidates.map((c) => c.id));
    const by_product = await this.buildByProduct(projectId, activeAsOfTo);
    const recent_events = await this.buildRecentEvents(recentTx);

    const in_trial = activeAsOfTo.filter((s) => s.periodType === 'TRIAL' || s.periodType === 'INTRO').length;
    const grace = activeAsOfTo.filter((s) => s.status === 'GRACE_PERIOD').length;

    const byStoreMap = new Map<string, number>();
    for (const s of activeAsOfTo) byStoreMap.set(s.store, (byStoreMap.get(s.store) ?? 0) + 1);
    const by_store: SubscriptionsByStore[] = [...byStoreMap.entries()].map(([store, active]) => ({ store, active }));

    const trials_started = subsInRange.filter((s) => s.periodType === 'TRIAL' || s.periodType === 'INTRO').length;

    return {
      mrr_cents: mrrResult.mrrCents,
      active: activeResult.current,
      in_trial,
      grace,
      new_subscriptions: subsInRange.length,
      churned: churnedSubs.length,
      trials_started,
      trials_converted,
      by_day: this.buildByDay(from, to, subsInRange, churnedSubs, revenueTx),
      by_product,
      by_store,
      churn_reasons: buildChurnReasons(churnedSubs),
      recent_events,
    };
  }

  private fetchActiveAsOfTo(projectId: string, environment: Environment, to: Date): Promise<ActiveAsOfToRow[]> {
    return this.prisma.subscription.findMany({
      where: {
        projectId,
        environment,
        status: { in: ACTIVE_SUBSCRIPTION_STATUSES },
        purchasedAt: { lte: to },
        OR: [{ expiresAt: null }, { expiresAt: { gt: to } }],
      },
      select: { productId: true, storeProductId: true, store: true, status: true, periodType: true, priceCents: true, currency: true },
    });
  }

  /** "Churned" (design §1.2): a terminal signal in `[from, to]` — voluntary unsubscribe, a refund,
   * or an expiration for a non-renewing/expired sub. `billingIssueDetectedAt` is NOT a membership
   * signal here (it only ranks the churn *reason* once a sub already qualifies via one of these). */
  private fetchChurnedInRange(projectId: string, environment: Environment, from: Date, to: Date): Promise<ChurnedSubRow[]> {
    return this.prisma.subscription.findMany({
      where: {
        projectId,
        environment,
        OR: [
          { unsubscribeDetectedAt: { gte: from, lte: to } },
          { refundedAt: { gte: from, lte: to } },
          { expiresAt: { gte: from, lte: to }, OR: [{ status: 'EXPIRED' }, { autoRenewStatus: false }] },
        ],
      },
      select: { billingIssueDetectedAt: true, unsubscribeDetectedAt: true, refundedAt: true, expiresAt: true },
    });
  }

  /** `trials_converted` (design §1.2): the sub's own row is already NORMAL + active-status +
   * purchased in-window (the caller's `convertedCandidates` query); "a prior trial signal" is a
   * Transaction row for the same subscription with `isTrialPeriod = true`. */
  private async countConvertedTrials(subscriptionIds: string[]): Promise<number> {
    if (subscriptionIds.length === 0) return 0;
    const trialTx = await this.prisma.transaction.findMany({
      where: { subscriptionId: { in: subscriptionIds }, isTrialPeriod: true },
      select: { subscriptionId: true },
      distinct: ['subscriptionId'],
    });
    return trialTx.length;
  }

  /** `by_product` groups by `storeProductId` (never null, unlike the nullable catalog `productId`
   * FK) so every active sub is represented even before its store product is imported into the
   * catalog; `mrr_cents` sums only the subs whose catalog Product resolves a period (same
   * unattributed-exclusion rule as `MetricsService.mrr`). */
  private async buildByProduct(projectId: string, activeAsOfTo: ActiveAsOfToRow[]): Promise<SubscriptionsByProduct[]> {
    const productIds = [...new Set(activeAsOfTo.map((s) => s.productId).filter((id): id is string => id !== null))];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds }, projectId }, select: { id: true, durationIso8601: true } })
      : [];
    const multiplierByProductId = new Map(products.map((p) => [p.id, monthlyMultiplier(p.durationIso8601)]));

    const byProduct = new Map<string, { active: number; mrrCents: number }>();
    for (const s of activeAsOfTo) {
      const acc = byProduct.get(s.storeProductId) ?? { active: 0, mrrCents: 0 };
      acc.active += 1;
      const multiplier = s.productId ? multiplierByProductId.get(s.productId) ?? null : null;
      if (multiplier !== null && s.priceCents !== null) {
        acc.mrrCents += Math.round(s.priceCents * multiplier);
      }
      byProduct.set(s.storeProductId, acc);
    }
    return [...byProduct.entries()].map(([product_id, acc]) => ({ product_id, active: acc.active, mrr_cents: acc.mrrCents }));
  }

  private buildByDay(
    from: Date,
    to: Date,
    subsInRange: SubInRangeRow[],
    churnedSubs: ChurnedSubRow[],
    revenueTx: RevenueTxRow[],
  ): SubscriptionsByDay[] {
    const buckets = generateBuckets(from, to, 'day');
    const key = (d: Date) => truncateUtc(d, 'day').toISOString();

    const newByBucket = new Map<string, number>();
    for (const s of subsInRange) {
      const k = key(s.purchasedAt);
      newByBucket.set(k, (newByBucket.get(k) ?? 0) + 1);
    }

    const churnedByBucket = new Map<string, number>();
    for (const s of churnedSubs) {
      const at = churnedAt(s, from, to);
      if (at === null) continue;
      const k = key(at);
      churnedByBucket.set(k, (churnedByBucket.get(k) ?? 0) + 1);
    }

    const revenueByBucket = new Map<string, number>();
    for (const t of revenueTx) {
      const k = key(t.purchasedAt);
      revenueByBucket.set(k, (revenueByBucket.get(k) ?? 0) + (t.priceCents ?? 0));
    }

    return buckets.map((b) => {
      const k = b.toISOString();
      return {
        t: k,
        new_subscriptions: newByBucket.get(k) ?? 0,
        churned: churnedByBucket.get(k) ?? 0,
        revenue: revenueByBucket.get(k) ?? 0,
      };
    });
  }

  /** `distinct_id` joins `Customer.appUserId`; unlinked transactions (`customerId === null`) fall
   * back to `''` (no identity to report). `event` is inferred from the transaction's own shape —
   * a refund/chargeback (`revokedAt` set) is `$rc_cancellation`; a transaction that IS its own
   * original (`originalTransactionId` unset or equal to its own store transaction id) is
   * `$rc_initial_purchase`; everything else is `$rc_renewal` — the same vocabulary the
   * `mobile_analytics` RC mirror uses. */
  private async buildRecentEvents(recentTx: RecentTxRow[]): Promise<SubscriptionRecentEvent[]> {
    const customerIds = [...new Set(recentTx.map((t) => t.customerId).filter((id): id is string => id !== null))];
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, appUserId: true } })
      : [];
    const appUserIdByCustomerId = new Map(customers.map((c) => [c.id, c.appUserId]));

    return recentTx.map((t) => ({
      insert_id: t.id,
      event: inferEventName(t),
      distinct_id: (t.customerId && appUserIdByCustomerId.get(t.customerId)) || '',
      timestamp: t.purchasedAt.toISOString(),
      product_id: t.storeProductId,
      price: (t.priceCents ?? 0) / 100,
    }));
  }
}

/** The `[from,to]` date that made `sub` count as churned (design §1.2's terminal-signal
 * definition), used to bucket `by_day.churned`; priority: unsubscribe > refund > terminal
 * expiration. */
function churnedAt(sub: ChurnedSubRow, from: Date, to: Date): Date | null {
  const inRange = (d: Date | null) => d !== null && d.getTime() >= from.getTime() && d.getTime() <= to.getTime();
  if (inRange(sub.unsubscribeDetectedAt)) return sub.unsubscribeDetectedAt;
  if (inRange(sub.refundedAt)) return sub.refundedAt;
  if (inRange(sub.expiresAt)) return sub.expiresAt;
  return null;
}

/** Maps a churned sub's billing signals to an RC-style reason (design §1.2 priority order). */
function churnReason(sub: ChurnedSubRow): string {
  if (sub.billingIssueDetectedAt !== null) return 'billing_error';
  if (sub.unsubscribeDetectedAt !== null) return 'voluntary_cancel';
  if (sub.refundedAt !== null) return 'refund';
  return 'expiration';
}

function buildChurnReasons(churnedSubs: ChurnedSubRow[]): ChurnReasonCount[] {
  const counts = new Map<string, number>();
  for (const s of churnedSubs) {
    const reason = churnReason(s);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function inferEventName(t: { revokedAt: Date | null; originalTransactionId: string | null; storeTransactionId: string }): string {
  if (t.revokedAt !== null) return '$rc_cancellation';
  if (t.originalTransactionId === null || t.originalTransactionId === t.storeTransactionId) return '$rc_initial_purchase';
  return '$rc_renewal';
}
