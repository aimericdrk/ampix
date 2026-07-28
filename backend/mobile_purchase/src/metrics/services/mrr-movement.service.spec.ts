import type { PrismaService } from '../../prisma/prisma.service';
import type { MetricsQuery } from '../support/metrics.schemas';
import { MrrMovementService } from './mrr-movement.service';

const PID = 'proj-1';
const PROD = 'prod-monthly';

/** A monthly window: from Jan 1 to Jan 3 (UTC) at day granularity → buckets Jan1, Jan2, Jan3. */
const QUERY: MetricsQuery = {
  from: new Date('2026-01-01T00:00:00.000Z'),
  to: new Date('2026-01-03T00:00:00.000Z'),
  granularity: 'day',
  environment: 'PRODUCTION',
};

function d(iso: string): Date {
  return new Date(iso);
}

interface Sub {
  id: string;
  productId: string | null;
  priceCents: number | null;
  currency: string | null;
  purchasedAt: Date;
  originalPurchasedAt: Date | null;
  expiresAt: Date | null;
  refundedAt: Date | null;
}

interface Tx {
  subscriptionId: string | null;
  priceCents: number | null;
  purchasedAt: Date;
  revokedAt: Date | null;
}

function makeService(subs: Sub[], txns: Tx[] = [], duration = 'P1M'): MrrMovementService {
  const prisma = {
    subscription: { findMany: jest.fn().mockResolvedValue(subs) },
    product: { findMany: jest.fn().mockResolvedValue([{ id: PROD, durationIso8601: duration }]) },
    transaction: {
      findMany: jest
        .fn()
        .mockResolvedValue([...txns].sort((a, b) => a.purchasedAt.getTime() - b.purchasedAt.getTime())),
    },
  };
  return new MrrMovementService(prisma as unknown as PrismaService);
}

/** A well-formed subscription with sensible defaults; override per scenario. */
function sub(partial: Partial<Sub> & Pick<Sub, 'id'>): Sub {
  return {
    productId: PROD,
    priceCents: 1000,
    currency: 'USD',
    purchasedAt: d('2025-12-01T00:00:00.000Z'),
    originalPurchasedAt: null,
    expiresAt: d('2026-02-01T00:00:00.000Z'),
    refundedAt: null,
    ...partial,
  };
}

describe('MrrMovementService', () => {
  it('classifies a first-time subscriber as New in the bucket it activates', async () => {
    const service = makeService([
      sub({ id: 's-new', purchasedAt: d('2026-01-01T12:00:00.000Z'), originalPurchasedAt: d('2026-01-01T12:00:00.000Z') }),
    ]);

    const result = await service.mrrMovement(PID, QUERY);

    expect(result.currency).toBe('USD');
    expect(result.totals.new_cents).toBe(1000);
    expect(result.totals.reactivation_cents).toBe(0);
    // Jan1 bucket [Jan1 → Jan2]: inactive at Jan1 00:00, active by Jan2 00:00.
    const jan1 = result.buckets.find((b) => b.bucket === '2026-01-01T00:00:00.000Z');
    expect(jan1?.new_cents).toBe(1000);
    expect(jan1?.net_cents).toBe(1000);
  });

  it('classifies a returning subscriber (earlier originalPurchasedAt) as Reactivation', async () => {
    const service = makeService([
      sub({
        id: 's-react',
        purchasedAt: d('2026-01-01T12:00:00.000Z'),
        originalPurchasedAt: d('2025-11-01T00:00:00.000Z'),
      }),
    ]);

    const result = await service.mrrMovement(PID, QUERY);

    expect(result.totals.reactivation_cents).toBe(1000);
    expect(result.totals.new_cents).toBe(0);
  });

  it('classifies a lapsing subscriber as Churn (negative) in the bucket it expires', async () => {
    const service = makeService([
      sub({ id: 's-churn', purchasedAt: d('2025-12-15T00:00:00.000Z'), expiresAt: d('2026-01-02T12:00:00.000Z') }),
    ]);

    const result = await service.mrrMovement(PID, QUERY);

    expect(result.totals.churn_cents).toBe(-1000);
    // Active at Jan2 00:00 (expires Jan2 12:00), gone by Jan3 00:00 → churn lands in the Jan2 bucket.
    const jan2 = result.buckets.find((b) => b.bucket === '2026-01-02T00:00:00.000Z');
    expect(jan2?.churn_cents).toBe(-1000);
    expect(jan2?.net_cents).toBe(-1000);
  });

  it('reads a mid-life price increase from transactions as Expansion', async () => {
    const service = makeService(
      [sub({ id: 's-exp', priceCents: 2000 })],
      [
        { subscriptionId: 's-exp', priceCents: 1000, purchasedAt: d('2025-12-01T00:00:00.000Z'), revokedAt: null },
        { subscriptionId: 's-exp', priceCents: 2000, purchasedAt: d('2026-01-02T06:00:00.000Z'), revokedAt: null },
      ],
    );

    const result = await service.mrrMovement(PID, QUERY);

    expect(result.totals.expansion_cents).toBe(1000);
    expect(result.totals.contraction_cents).toBe(0);
    // Price 1000 through Jan2 00:00, 2000 by Jan3 00:00 → +1000 in the Jan2 bucket.
    const jan2 = result.buckets.find((b) => b.bucket === '2026-01-02T00:00:00.000Z');
    expect(jan2?.expansion_cents).toBe(1000);
  });

  it('reads a mid-life price decrease as Contraction (negative)', async () => {
    const service = makeService(
      [sub({ id: 's-con', priceCents: 1000 })],
      [
        { subscriptionId: 's-con', priceCents: 2000, purchasedAt: d('2025-12-01T00:00:00.000Z'), revokedAt: null },
        { subscriptionId: 's-con', priceCents: 1000, purchasedAt: d('2026-01-02T06:00:00.000Z'), revokedAt: null },
      ],
    );

    const result = await service.mrrMovement(PID, QUERY);

    expect(result.totals.contraction_cents).toBe(-1000);
    expect(result.totals.expansion_cents).toBe(0);
  });

  it('reconciles net to the sum of the five categories for every bucket', async () => {
    const service = makeService([
      sub({ id: 's-new', purchasedAt: d('2026-01-01T12:00:00.000Z'), originalPurchasedAt: d('2026-01-01T12:00:00.000Z') }),
      sub({ id: 's-churn', purchasedAt: d('2025-12-15T00:00:00.000Z'), expiresAt: d('2026-01-02T12:00:00.000Z') }),
    ]);

    const result = await service.mrrMovement(PID, QUERY);

    for (const b of result.buckets) {
      expect(b.net_cents).toBe(
        b.new_cents + b.reactivation_cents + b.expansion_cents + b.contraction_cents + b.churn_cents,
      );
    }
  });

  it('returns null currency and zeroed totals when there is no attributable MRR', async () => {
    const service = makeService([sub({ id: 's-x', productId: null })]);

    const result = await service.mrrMovement(PID, QUERY);

    expect(result.currency).toBeNull();
    expect(result.totals.net_cents).toBe(0);
    expect(result.buckets.every((b) => b.net_cents === 0)).toBe(true);
  });
});
