import type { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../crypto/password.service';
import { RECOVERY_CODE_COUNT, RecoveryCodeService } from './recovery-code.service';

interface Row {
  id: string;
  userId: string;
  codeHash: string;
  usedAt: Date | null;
}

class FakePrisma {
  rows: Row[] = [];
  private nextId = 0;

  twoFactorRecoveryCode = {
    createMany: async ({ data }: { data: { userId: string; codeHash: string }[] }) => {
      for (const d of data) {
        this.rows.push({
          id: `row-${this.nextId++}`,
          userId: d.userId,
          codeHash: d.codeHash,
          usedAt: null,
        });
      }
      return { count: data.length };
    },
    findMany: async ({ where }: { where: { userId: string; usedAt: null } }) => {
      return this.rows.filter((r) => r.userId === where.userId && r.usedAt === where.usedAt);
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; usedAt: null };
      data: { usedAt: Date };
    }) => {
      const row = this.rows.find((r) => r.id === where.id && r.usedAt === where.usedAt);
      if (!row) return { count: 0 };
      row.usedAt = data.usedAt;
      return { count: 1 };
    },
    deleteMany: async ({ where }: { where: { userId: string } }) => {
      const before = this.rows.length;
      this.rows = this.rows.filter((r) => r.userId !== where.userId);
      return { count: before - this.rows.length };
    },
  };
}

const USER_ID = '018f6b2e-0000-7000-8000-000000000001';

describe('RecoveryCodeService', () => {
  function makeService() {
    const prisma = new FakePrisma();
    const service = new RecoveryCodeService(
      prisma as unknown as PrismaService,
      new PasswordService(),
    );
    return { service, prisma };
  }

  it('generates RECOVERY_CODE_COUNT unique, human-typeable codes and persists only their hashes', async () => {
    const { service, prisma } = makeService();
    const codes = await service.generateAndStore(USER_ID);

    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT); // no duplicates
    for (const code of codes) {
      expect(code).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    }
    expect(prisma.rows).toHaveLength(RECOVERY_CODE_COUNT);
    for (const row of prisma.rows) {
      expect(codes).not.toContain(row.codeHash); // plaintext is never what's stored
      expect(row.codeHash).toMatch(/^\$argon2id\$/);
    }
  });

  it('consumes a valid unused code exactly once', async () => {
    const { service } = makeService();
    const [code] = await service.generateAndStore(USER_ID);

    await expect(service.consume(USER_ID, code)).resolves.toBe(true);
    // Second attempt with the same code must fail — single use.
    await expect(service.consume(USER_ID, code)).resolves.toBe(false);
  });

  it('rejects a code that was never issued', async () => {
    const { service } = makeService();
    await service.generateAndStore(USER_ID);
    await expect(service.consume(USER_ID, 'not-a-real-code')).resolves.toBe(false);
  });

  it('rejects a code issued for a different user', async () => {
    const { service } = makeService();
    const [code] = await service.generateAndStore('some-other-user');
    await expect(service.consume(USER_ID, code)).resolves.toBe(false);
  });

  it('clearAll removes every recovery code row for the user', async () => {
    const { service, prisma } = makeService();
    await service.generateAndStore(USER_ID);
    expect(prisma.rows).toHaveLength(RECOVERY_CODE_COUNT);
    await service.clearAll(USER_ID);
    expect(prisma.rows).toHaveLength(0);
  });
});
