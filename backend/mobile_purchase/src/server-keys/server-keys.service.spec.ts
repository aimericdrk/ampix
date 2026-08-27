import type { PrismaService } from '../prisma/prisma.service';
import { ServerKeysService } from './server-keys.service';

interface FakeServerKey {
  id: string;
  projectId: string;
  label: string;
  key: string;
  canErase: boolean;
  revokedAt: Date | null;
  createdAt: Date;
}

const ID_A = '018f6b2e-0000-7000-8000-0000000000a1';
const ID_OTHER_PROJECT = '018f6b2e-0000-7000-8000-0000000000b2';

class FakePrisma {
  rows: FakeServerKey[] = [];
  private next = 0;

  serverKey = {
    create: async ({ data }: { data: Omit<FakeServerKey, 'id' | 'revokedAt' | 'createdAt'> }) => {
      const row: FakeServerKey = {
        id: `018f6b2e-0000-7000-8000-00000000000${this.next++}`,
        revokedAt: null,
        createdAt: new Date(),
        ...data,
      };
      this.rows.push(row);
      return row;
    },
    findMany: async ({ where }: { where: { projectId: string; revokedAt: null } }) =>
      this.rows.filter((r) => r.projectId === where.projectId && r.revokedAt === null),
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.rows.find((r) => r.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeServerKey> }) => {
      const row = this.rows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };
}

const makeService = (prisma: FakePrisma) =>
  new ServerKeysService(prisma as unknown as PrismaService);

describe('ServerKeysService', () => {
  describe('create', () => {
    it('mints an mp_srv_ key with the given label', async () => {
      const prisma = new FakePrisma();
      const created = await makeService(prisma).create('p1', 'account deletion');
      expect(created.key).toMatch(/^mp_srv_[0-9a-f]{32}$/);
      expect(created.label).toBe('account deletion');
    });

    it('defaults the label when omitted', async () => {
      const prisma = new FakePrisma();
      expect((await makeService(prisma).create('p1')).label).toBe('default');
    });

    // The capability is opt-in: a key minted for routine backend calls can't delete anything.
    it('withholds the erase capability unless it is asked for', async () => {
      const prisma = new FakePrisma();
      const created = await makeService(prisma).create('p1', 'relay');
      expect(created.can_erase).toBe(false);
      expect(prisma.rows.at(-1)?.canErase).toBe(false);
    });

    it('persists the erase capability when asked for', async () => {
      const prisma = new FakePrisma();
      const created = await makeService(prisma).create('p1', 'account deletion', true);
      expect(created.can_erase).toBe(true);
      expect(prisma.rows.at(-1)?.canErase).toBe(true);
    });
  });

  describe('list', () => {
    it('returns only this project\'s live keys', async () => {
      const prisma = new FakePrisma();
      const service = makeService(prisma);
      await service.create('p1', 'live');
      await service.create('p2', 'other project');
      const revoked = await service.create('p1', 'revoked');
      await service.revoke('p1', revoked.id);

      const keys = await service.list('p1');
      expect(keys.map((k) => k.label)).toEqual(['live']);
    });
  });

  describe('revoke', () => {
    it('stamps revokedAt rather than deleting the row', async () => {
      const prisma = new FakePrisma();
      const service = makeService(prisma);
      const created = await service.create('p1', 'account deletion', true);

      await service.revoke('p1', created.id);

      expect(prisma.rows).toHaveLength(1);
      expect(prisma.rows[0].revokedAt).not.toBeNull();
    });

    // Ids are never trusted alone: being admin of SOME project must not reach another's key.
    it('404s on a key belonging to a different project, leaving it live', async () => {
      const prisma = new FakePrisma();
      prisma.rows.push({
        id: ID_OTHER_PROJECT,
        projectId: 'p2',
        label: 'theirs',
        key: `mp_srv_${'f'.repeat(32)}`,
        canErase: true,
        revokedAt: null,
        createdAt: new Date(),
      });

      await expect(makeService(prisma).revoke('p1', ID_OTHER_PROJECT)).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(prisma.rows[0].revokedAt).toBeNull();
    });

    it('404s on an unknown id and on an id that is not uuid-shaped', async () => {
      const service = makeService(new FakePrisma());
      await expect(service.revoke('p1', ID_A)).rejects.toMatchObject({ problem: { status: 404 } });
      await expect(service.revoke('p1', 'not-a-uuid')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('404s on an already-revoked key', async () => {
      const prisma = new FakePrisma();
      const service = makeService(prisma);
      const created = await service.create('p1', 'account deletion', true);
      await service.revoke('p1', created.id);

      await expect(service.revoke('p1', created.id)).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });
  });
});
