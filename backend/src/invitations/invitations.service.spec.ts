import type { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from './invitations.service';

interface FakeInvitation {
  id: string;
  orgId: string;
  role: 'admin' | 'analyst' | 'viewer';
  token: string;
  expiresAt: Date;
  acceptedBy: string | null;
}

interface FakeMembership {
  userId: string;
  orgId: string;
  role: 'admin' | 'analyst' | 'viewer';
}

/** Small in-memory Prisma fake — the accept()/getByToken() branching is intricate enough that a
 *  real (if tiny) data store is clearer to assert against than a pile of one-off jest mocks. */
class FakePrisma {
  invitations: FakeInvitation[] = [];
  memberships: FakeMembership[] = [];
  organizations: { id: string; name: string }[] = [];
  private nextId = 0;

  invitation = {
    create: async ({ data }: { data: Omit<FakeInvitation, 'id' | 'acceptedBy'> }) => {
      const row: FakeInvitation = { id: `inv-${this.nextId++}`, acceptedBy: null, ...data };
      this.invitations.push(row);
      return row;
    },
    findMany: async ({
      where,
    }: {
      where: { orgId: string; acceptedBy: null; expiresAt: { gt: Date } };
    }) =>
      this.invitations.filter(
        (i) => i.orgId === where.orgId && i.acceptedBy === null && i.expiresAt > where.expiresAt.gt,
      ),
    findUnique: async ({ where }: { where: { token?: string; id?: string } }) => {
      const invitation =
        where.token !== undefined
          ? this.invitations.find((i) => i.token === where.token)
          : this.invitations.find((i) => i.id === where.id);
      if (!invitation) return null;
      const org = this.organizations.find((o) => o.id === invitation.orgId);
      return { ...invitation, org };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeInvitation> }) => {
      const invitation = this.invitations.find((i) => i.id === where.id);
      if (!invitation) throw new Error('not found');
      Object.assign(invitation, data);
      return invitation;
    },
    deleteMany: async ({ where }: { where: { id: string; orgId: string } }) => {
      const before = this.invitations.length;
      this.invitations = this.invitations.filter(
        (i) => !(i.id === where.id && i.orgId === where.orgId),
      );
      return { count: before - this.invitations.length };
    },
  };

  membership = {
    findUnique: async ({ where }: { where: { userId_orgId: { userId: string; orgId: string } } }) =>
      this.memberships.find(
        (m) => m.userId === where.userId_orgId.userId && m.orgId === where.userId_orgId.orgId,
      ) ?? null,
    create: async ({ data }: { data: FakeMembership }) => {
      this.memberships.push({ ...data });
      return data;
    },
  };

  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

function makeService(prisma: FakePrisma) {
  return new InvitationsService(prisma as unknown as PrismaService);
}

describe('InvitationsService', () => {
  describe('create', () => {
    it('generates a urlsafe token, expires in 7 days, and returns the invite_path', async () => {
      const prisma = new FakePrisma();
      const service = makeService(prisma);

      const before = Date.now();
      const invitation = await service.create('org-1', 'viewer');
      const after = Date.now();

      expect(invitation.role).toBe('viewer');
      expect(invitation.token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
      expect(invitation.invite_path).toBe(`/invite/${invitation.token}`);

      const expiresAtMs = new Date(invitation.expires_at).getTime();
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS - 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + SEVEN_DAYS_MS + 1000);
    });

    it('generates a different token every time', async () => {
      const prisma = new FakePrisma();
      const service = makeService(prisma);
      const a = await service.create('org-1', 'viewer');
      const b = await service.create('org-1', 'viewer');
      expect(a.token).not.toBe(b.token);
    });
  });

  describe('listPending', () => {
    it('returns only invitations that are neither accepted nor expired', async () => {
      const prisma = new FakePrisma();
      const now = Date.now();
      prisma.invitations = [
        {
          id: 'pending',
          orgId: 'org-1',
          role: 'viewer',
          token: 't1',
          expiresAt: new Date(now + 10_000),
          acceptedBy: null,
        },
        {
          id: 'accepted',
          orgId: 'org-1',
          role: 'viewer',
          token: 't2',
          expiresAt: new Date(now + 10_000),
          acceptedBy: 'user-1',
        },
        {
          id: 'expired',
          orgId: 'org-1',
          role: 'viewer',
          token: 't3',
          expiresAt: new Date(now - 10_000),
          acceptedBy: null,
        },
        {
          id: 'other-org',
          orgId: 'org-2',
          role: 'viewer',
          token: 't4',
          expiresAt: new Date(now + 10_000),
          acceptedBy: null,
        },
      ];
      const service = makeService(prisma);

      const pending = await service.listPending('org-1');

      expect(pending.map((p) => p.id)).toEqual(['pending']);
    });
  });

  describe('remove', () => {
    it('deletes when the invitation belongs to the given org', async () => {
      const prisma = new FakePrisma();
      prisma.invitations = [
        {
          id: 'inv-1',
          orgId: 'org-1',
          role: 'viewer',
          token: 't1',
          expiresAt: new Date(),
          acceptedBy: null,
        },
      ];
      const service = makeService(prisma);

      await service.remove('org-1', 'inv-1');
      expect(prisma.invitations).toHaveLength(0);
    });

    it('404s and does not delete when the invitation belongs to a DIFFERENT org — SECURITY-CRITICAL', async () => {
      const prisma = new FakePrisma();
      prisma.invitations = [
        {
          id: 'inv-1',
          orgId: 'org-2',
          role: 'viewer',
          token: 't1',
          expiresAt: new Date(),
          acceptedBy: null,
        },
      ];
      const service = makeService(prisma);

      await expect(service.remove('org-1', 'inv-1')).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(prisma.invitations).toHaveLength(1);
    });

    it('404s for an unknown invitation id', async () => {
      const service = makeService(new FakePrisma());
      await expect(service.remove('org-1', 'missing')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });
  });

  describe('getByToken', () => {
    it('returns org_name/role/expires_at for a valid pending invitation', async () => {
      const prisma = new FakePrisma();
      prisma.organizations = [{ id: 'org-1', name: 'Acme' }];
      prisma.invitations = [
        {
          id: 'inv-1',
          orgId: 'org-1',
          role: 'analyst',
          token: 't1',
          expiresAt: new Date(Date.now() + 10_000),
          acceptedBy: null,
        },
      ];
      const service = makeService(prisma);

      const result = await service.getByToken('t1');
      expect(result.org_name).toBe('Acme');
      expect(result.role).toBe('analyst');
    });

    it('404s for an unknown token', async () => {
      const service = makeService(new FakePrisma());
      await expect(service.getByToken('unknown')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('410s for an expired invitation', async () => {
      const prisma = new FakePrisma();
      prisma.organizations = [{ id: 'org-1', name: 'Acme' }];
      prisma.invitations = [
        {
          id: 'inv-1',
          orgId: 'org-1',
          role: 'viewer',
          token: 't1',
          expiresAt: new Date(Date.now() - 10_000),
          acceptedBy: null,
        },
      ];
      const service = makeService(prisma);
      await expect(service.getByToken('t1')).rejects.toMatchObject({ problem: { status: 410 } });
    });

    it('410s for an already-accepted invitation', async () => {
      const prisma = new FakePrisma();
      prisma.organizations = [{ id: 'org-1', name: 'Acme' }];
      prisma.invitations = [
        {
          id: 'inv-1',
          orgId: 'org-1',
          role: 'viewer',
          token: 't1',
          expiresAt: new Date(Date.now() + 10_000),
          acceptedBy: 'user-1',
        },
      ];
      const service = makeService(prisma);
      await expect(service.getByToken('t1')).rejects.toMatchObject({ problem: { status: 410 } });
    });
  });

  describe('accept', () => {
    it('creates a Membership and marks the invitation accepted for a brand new member', async () => {
      const prisma = new FakePrisma();
      prisma.invitations = [
        {
          id: 'inv-1',
          orgId: 'org-1',
          role: 'viewer',
          token: 't1',
          expiresAt: new Date(Date.now() + 10_000),
          acceptedBy: null,
        },
      ];
      const service = makeService(prisma);

      const result = await service.accept('t1', 'user-1');

      expect(result).toEqual({ org_id: 'org-1', role: 'viewer' });
      expect(prisma.memberships).toEqual([{ userId: 'user-1', orgId: 'org-1', role: 'viewer' }]);
      expect(prisma.invitations[0].acceptedBy).toBe('user-1');
    });

    it('404s for an unknown token', async () => {
      const service = makeService(new FakePrisma());
      await expect(service.accept('unknown', 'user-1')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('410s for an expired invitation, even if never accepted', async () => {
      const prisma = new FakePrisma();
      prisma.invitations = [
        {
          id: 'inv-1',
          orgId: 'org-1',
          role: 'viewer',
          token: 't1',
          expiresAt: new Date(Date.now() - 10_000),
          acceptedBy: null,
        },
      ];
      const service = makeService(prisma);
      await expect(service.accept('t1', 'user-1')).rejects.toMatchObject({
        problem: { status: 410 },
      });
    });

    it('410s (single-use) when a SECOND user tries to accept an already-accepted token', async () => {
      const prisma = new FakePrisma();
      prisma.invitations = [
        {
          id: 'inv-1',
          orgId: 'org-1',
          role: 'viewer',
          token: 't1',
          expiresAt: new Date(Date.now() + 10_000),
          acceptedBy: 'user-1',
        },
      ];
      const service = makeService(prisma);
      await expect(service.accept('t1', 'user-2')).rejects.toMatchObject({
        problem: { status: 410 },
      });
    });

    it('is idempotent when the SAME user replays accept on a token they already accepted', async () => {
      const prisma = new FakePrisma();
      prisma.invitations = [
        {
          id: 'inv-1',
          orgId: 'org-1',
          role: 'viewer',
          token: 't1',
          expiresAt: new Date(Date.now() + 10_000),
          acceptedBy: 'user-1',
        },
      ];
      prisma.memberships = [{ userId: 'user-1', orgId: 'org-1', role: 'viewer' }];
      const service = makeService(prisma);

      await expect(service.accept('t1', 'user-1')).resolves.toEqual({
        org_id: 'org-1',
        role: 'viewer',
      });
      expect(prisma.memberships).toHaveLength(1); // no duplicate membership row
    });

    it('is idempotent — keeps the EXISTING role — when the caller is already a member some other way', async () => {
      const prisma = new FakePrisma();
      prisma.invitations = [
        {
          id: 'inv-1',
          orgId: 'org-1',
          role: 'admin',
          token: 't1',
          expiresAt: new Date(Date.now() + 10_000),
          acceptedBy: null,
        },
      ];
      // Already a member with a DIFFERENT role than the invitation grants.
      prisma.memberships = [{ userId: 'user-1', orgId: 'org-1', role: 'viewer' }];
      const service = makeService(prisma);

      const result = await service.accept('t1', 'user-1');

      expect(result).toEqual({ org_id: 'org-1', role: 'viewer' }); // NOT upgraded to admin
      expect(prisma.memberships).toHaveLength(1);
      expect(prisma.invitations[0].acceptedBy).toBe('user-1'); // still marked single-use
    });
  });
});
