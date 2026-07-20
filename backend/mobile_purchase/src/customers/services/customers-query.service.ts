import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ACTIVE_SUBSCRIPTION_STATUSES } from '../../metrics/services/metrics.service';
import { decodeCustomersCursor, encodeCustomersCursor } from '../support/cursor';
import type { CustomersListQuery } from '../support/customers.schemas';

export interface CustomerListRow {
  id: string;
  appUserId: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  activeSubscriptionCount: number;
  totalSpentCents: number;
  currency: string | null;
}

export interface CustomersListResult {
  items: CustomerListRow[];
  nextCursor: string | null;
}

/**
 * Dashboard-facing customers LIST (design §1.3): search + keyset pagination on
 * `(createdAt DESC, id DESC)` + per-row aggregates computed via GROUPED queries — never per-row
 * `computeCustomerInfo` (keeps the list cheap even at scale). `activeSubscriptionCount` reuses
 * `ACTIVE_SUBSCRIPTION_STATUSES` from `metrics.service.ts` (same active-status list, design §1.3).
 */
@Injectable()
export class CustomersQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string, query: CustomersListQuery): Promise<CustomersListResult> {
    const { search, limit, cursor } = query;
    const decoded = cursor ? decodeCustomersCursor(cursor) : null;

    const rows = await this.prisma.customer.findMany({
      where: {
        projectId,
        ...(search ? { appUserId: { contains: search, mode: 'insensitive' as const } } : {}),
        ...(decoded
          ? {
              OR: [
                { createdAt: { lt: decoded.createdAt } },
                { createdAt: decoded.createdAt, id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const customerIds = page.map((c) => c.id);

    if (customerIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    const [subCounts, spendRows] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['customerId', 'currency'],
        where: { customerId: { in: customerIds }, revokedAt: null },
        _sum: { priceCents: true },
      }),
    ]);

    const subCountByCustomer = new Map(subCounts.map((r) => [r.customerId, r._count._all]));
    const spendByCustomer = new Map<string, { totalCents: number; byCurrency: Map<string, number> }>();
    for (const row of spendRows) {
      if (row.customerId === null) continue;
      const amount = row._sum.priceCents ?? 0;
      const entry = spendByCustomer.get(row.customerId) ?? { totalCents: 0, byCurrency: new Map<string, number>() };
      entry.totalCents += amount;
      if (row.currency !== null) {
        entry.byCurrency.set(row.currency, (entry.byCurrency.get(row.currency) ?? 0) + amount);
      }
      spendByCustomer.set(row.customerId, entry);
    }

    const items: CustomerListRow[] = page.map((c) => {
      const spend = spendByCustomer.get(c.id);
      return {
        id: c.id,
        appUserId: c.appUserId,
        createdAt: c.createdAt,
        lastSeenAt: c.lastSeenAt,
        activeSubscriptionCount: subCountByCustomer.get(c.id) ?? 0,
        totalSpentCents: spend?.totalCents ?? 0,
        currency: spend ? pickDominantCurrency(spend.byCurrency) : null,
      };
    });

    const last = page[page.length - 1];
    const nextCursor = hasMore ? encodeCustomersCursor({ createdAt: last.createdAt, id: last.id }) : null;

    return { items, nextCursor };
  }
}

/** Largest total wins; ties broken alphabetically — the same convention `metrics.service.ts`
 * uses for its per-currency dominant-currency selection. */
function pickDominantCurrency(byCurrency: Map<string, number>): string | null {
  let best: { currency: string; total: number } | null = null;
  for (const [currency, total] of byCurrency) {
    if (best === null || total > best.total || (total === best.total && currency.localeCompare(best.currency) < 0)) {
      best = { currency, total };
    }
  }
  return best?.currency ?? null;
}
