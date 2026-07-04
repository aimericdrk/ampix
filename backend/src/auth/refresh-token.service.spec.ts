import type { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';
import { makeAuthTestConfig } from './test-support/config.fixture';

interface Row {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

class FakePrisma {
  rows: Row[] = [];
  private nextId = 0;

  refreshToken = {
    create: async ({ data }: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
      const row: Row = {
        id: `row-${this.nextId++}`,
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        revokedAt: null,
      };
      this.rows.push(row);
      return row;
    },
    findFirst: async ({ where }: { where: { tokenHash: string } }) => {
      return this.rows.find((r) => r.tokenHash === where.tokenHash) ?? null;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const matches = this.rows.filter((r) =>
        Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
      );
      matches.forEach((r) => Object.assign(r, data));
      return { count: matches.length };
    },
  };

  $transaction = async (ops: Promise<unknown>[]) => Promise.all(ops);
}

const USER_ID = '018f6b2e-0000-7000-8000-000000000001';

describe('RefreshTokenService', () => {
  function makeService(overrides: Parameters<typeof makeAuthTestConfig>[0] = {}) {
    const prisma = new FakePrisma();
    const service = new RefreshTokenService(
      prisma as unknown as PrismaService,
      makeAuthTestConfig(overrides),
    );
    return { service, prisma };
  }

  it('issues a token, persisting only its SHA-256 hash (never the raw value)', async () => {
    const { service, prisma } = makeService();
    const token = await service.issue(USER_ID);

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].userId).toBe(USER_ID);
    expect(prisma.rows[0].tokenHash).not.toBe(token);
    expect(prisma.rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex digest
    expect(prisma.rows[0].revokedAt).toBeNull();
  });

  it('sets expiresAt refreshTokenTtl seconds in the future', async () => {
    const { service, prisma } = makeService({
      auth: { ...makeAuthTestConfig().auth!, refreshTokenTtl: 1000 },
    });
    const before = Date.now();
    await service.issue(USER_ID);
    const expiresAt = prisma.rows[0].expiresAt.getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 1000 * 1000 - 1000);
    expect(expiresAt).toBeLessThanOrEqual(before + 1000 * 1000 + 5000);
  });

  it('rotates a valid token: revokes the old row and issues a new one', async () => {
    const { service, prisma } = makeService();
    const token = await service.issue(USER_ID);

    const rotated = await service.rotate(token);

    expect(rotated).not.toBeNull();
    expect(rotated!.userId).toBe(USER_ID);
    expect(rotated!.token).not.toBe(token);
    expect(prisma.rows).toHaveLength(2);
    expect(prisma.rows[0].revokedAt).not.toBeNull(); // old row revoked
    expect(prisma.rows[1].revokedAt).toBeNull(); // new row live
  });

  it('rejects rotating the same token twice (already revoked)', async () => {
    const { service } = makeService();
    const token = await service.issue(USER_ID);
    const first = await service.rotate(token);
    expect(first).not.toBeNull();

    const second = await service.rotate(token);
    expect(second).toBeNull();
  });

  it('rejects an unknown token', async () => {
    const { service } = makeService();
    await expect(service.rotate('not-a-real-token')).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const { service, prisma } = makeService();
    const token = await service.issue(USER_ID);
    prisma.rows[0].expiresAt = new Date(Date.now() - 1000);

    await expect(service.rotate(token)).resolves.toBeNull();
  });

  it('revokes a live token', async () => {
    const { service, prisma } = makeService();
    const token = await service.issue(USER_ID);

    await service.revoke(token);

    expect(prisma.rows[0].revokedAt).not.toBeNull();
  });

  it('revoke is a no-op (does not throw) for an unknown token', async () => {
    const { service } = makeService();
    await expect(service.revoke('unknown-token')).resolves.toBeUndefined();
  });

  it('a revoked token can no longer be rotated', async () => {
    const { service } = makeService();
    const token = await service.issue(USER_ID);
    await service.revoke(token);

    await expect(service.rotate(token)).resolves.toBeNull();
  });
});
