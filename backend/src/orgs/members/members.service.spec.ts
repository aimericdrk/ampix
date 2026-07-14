import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { MembersService } from './members.service';

// Container pull + `prisma migrate deploy` easily exceeds Jest's 5s default — see
// project-members.service.spec.ts for the same rationale.
jest.setTimeout(180000);

/**
 * SECURITY-CRITICAL: this suite exercises the last-admin and orphan-project-ownership
 * invariants against a REAL Postgres instance (Testcontainers) rather than mocks. Both
 * invariants rely on `remove`/`changeRole` running under SERIALIZABLE isolation to prevent
 * write-skew (see `runSerializable` in `members.service.ts` for the full explanation) — a mock
 * `$transaction` can't reproduce Postgres's predicate-lock-based conflict detection, so the
 * concurrency tests below need the genuine article to be meaningful.
 */
describe('MembersService (real Postgres)', () => {
  let prisma: PrismaClient;
  let service: MembersService;
  let container: Awaited<ReturnType<typeof startPostgresContainer>>['container'];

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new MembersService(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  afterEach(async () => {
    // Wipe in FK order so each test starts from a clean slate.
    await prisma.projectMembership.deleteMany();
    await prisma.project.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  });

  async function seedOrg() {
    return prisma.organization.create({ data: { name: 'Acme' } });
  }

  async function seedUser(email: string) {
    return prisma.user.create({ data: { email, passwordHash: 'x', name: email } });
  }

  /** Creates a user and makes them an org member with the given role. */
  async function seedMember(
    orgId: string,
    email: string,
    role: 'owner' | 'admin' | 'analyst' | 'viewer',
  ) {
    const user = await seedUser(email);
    await prisma.membership.create({ data: { userId: user.id, orgId, role } });
    return user;
  }

  async function seedProject(orgId: string, name = 'App') {
    return prisma.project.create({ data: { orgId, name } });
  }

  async function membershipRole(orgId: string, userId: string) {
    const membership = await prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    return membership?.role;
  }

  async function ownerCount(orgId: string) {
    return prisma.membership.count({ where: { orgId, role: 'owner' } });
  }

  async function addProjectMembership(
    projectId: string,
    userId: string,
    role: 'owner' | 'admin' | 'analyst' | 'viewer',
  ) {
    await prisma.projectMembership.create({ data: { projectId, userId, role } });
  }

  describe('list', () => {
    it('maps memberships -> { user, role }', async () => {
      const org = await seedOrg();
      const admin = await seedMember(org.id, 'a@b.com', 'admin');

      const members = await service.list(org.id);

      expect(members).toEqual([
        { user: { id: admin.id, email: admin.email, name: admin.name }, role: 'admin' },
      ]);
    });
  });

  describe('changeRole', () => {
    it('changes the role of a non-admin member', async () => {
      const org = await seedOrg();
      const viewer = await seedMember(org.id, 'viewer@acme.test', 'viewer');

      const result = await service.changeRole(org.id, viewer.id, viewer.id, 'analyst');

      expect(result).toEqual({ user_id: viewer.id, role: 'analyst' });
      const updated = await prisma.membership.findUnique({
        where: { userId_orgId: { userId: viewer.id, orgId: org.id } },
      });
      expect(updated?.role).toBe('analyst');
    });

    it('allows an admin -> admin "change" even when they are the only admin (no-op role)', async () => {
      const org = await seedOrg();
      const admin = await seedMember(org.id, 'admin@acme.test', 'admin');

      await expect(service.changeRole(org.id, admin.id, admin.id, 'admin')).resolves.toEqual({
        user_id: admin.id,
        role: 'admin',
      });
    });

    it('allows demoting an admin when there is another admin', async () => {
      const org = await seedOrg();
      const admin = await seedMember(org.id, 'admin1@acme.test', 'admin');
      await seedMember(org.id, 'admin2@acme.test', 'admin');

      await expect(service.changeRole(org.id, admin.id, admin.id, 'analyst')).resolves.toEqual({
        user_id: admin.id,
        role: 'analyst',
      });
    });

    it('404s when the target user is not a member of the org', async () => {
      const org = await seedOrg();
      const outsider = await seedUser('outsider@acme.test');

      await expect(service.changeRole(org.id, outsider.id, outsider.id, 'admin')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    // The malformed-userId "no DB touched" guarantee (changeRole + remove) is verified with spies
    // in members.service.unit.spec.ts — a real Prisma client has no clean hook for that assertion.
  });

  describe('changeRole — ownership transfer', () => {
    it('promoting a member to owner demotes the current owner to admin, atomically', async () => {
      const org = await seedOrg();
      const owner = await seedMember(org.id, 'owner@acme.test', 'owner');
      const member = await seedMember(org.id, 'member@acme.test', 'admin');

      const result = await service.changeRole(org.id, owner.id, member.id, 'owner');

      expect(result).toEqual({ user_id: member.id, role: 'owner' });
      expect(await membershipRole(org.id, member.id)).toBe('owner');
      expect(await membershipRole(org.id, owner.id)).toBe('admin');
      expect(await ownerCount(org.id)).toBe(1);
    });

    it('rejects a transfer initiated by a non-owner (403)', async () => {
      const org = await seedOrg();
      await seedMember(org.id, 'owner@acme.test', 'owner');
      const admin = await seedMember(org.id, 'admin@acme.test', 'admin');
      const member = await seedMember(org.id, 'member@acme.test', 'viewer');

      await expect(service.changeRole(org.id, admin.id, member.id, 'owner')).rejects.toMatchObject({
        problem: { status: 403 },
      });
    });

    it('rejects changing the current owner’s role directly (must transfer)', async () => {
      const org = await seedOrg();
      const owner = await seedMember(org.id, 'owner@acme.test', 'owner');

      await expect(service.changeRole(org.id, owner.id, owner.id, 'admin')).rejects.toMatchObject({
        problem: { status: 409 },
      });
    });
  });

  describe('last-admin guard removed', () => {
    it('lets the owner demote the only admin (owner keeps the org reachable)', async () => {
      const org = await seedOrg();
      const owner = await seedMember(org.id, 'owner@acme.test', 'owner');
      const admin = await seedMember(org.id, 'admin@acme.test', 'admin');

      const result = await service.changeRole(org.id, owner.id, admin.id, 'viewer');

      expect(result.role).toBe('viewer');
    });

    it('lets the owner remove the only admin (owner keeps the org reachable)', async () => {
      const org = await seedOrg();
      const owner = await seedMember(org.id, 'owner@acme.test', 'owner');
      const admin = await seedMember(org.id, 'admin@acme.test', 'admin');

      await expect(service.remove(org.id, admin.id)).resolves.toBeUndefined();

      const gone = await prisma.membership.findUnique({
        where: { userId_orgId: { userId: admin.id, orgId: org.id } },
      });
      expect(gone).toBeNull();
    });
  });

  describe('remove', () => {
    it('removes a non-admin member', async () => {
      const org = await seedOrg();
      const viewer = await seedMember(org.id, 'viewer@acme.test', 'viewer');

      await service.remove(org.id, viewer.id);

      const gone = await prisma.membership.findUnique({
        where: { userId_orgId: { userId: viewer.id, orgId: org.id } },
      });
      expect(gone).toBeNull();
    });

    it('allows removing an admin when there is another admin', async () => {
      const org = await seedOrg();
      const admin = await seedMember(org.id, 'admin1@acme.test', 'admin');
      await seedMember(org.id, 'admin2@acme.test', 'admin');

      await expect(service.remove(org.id, admin.id)).resolves.toBeUndefined();
      const gone = await prisma.membership.findUnique({
        where: { userId_orgId: { userId: admin.id, orgId: org.id } },
      });
      expect(gone).toBeNull();
    });

    it('404s when the target user is not a member of the org', async () => {
      const org = await seedOrg();
      const outsider = await seedUser('outsider@acme.test');

      await expect(service.remove(org.id, outsider.id)).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    // Malformed-userId "no DB touched" guarantee for remove() is verified in
    // members.service.unit.spec.ts (see the changeRole note above).

    describe('project-ownership orphan guard', () => {
      it('409s removing an org member who is the SOLE owner of a project in the org, and does not delete anything', async () => {
        const org = await seedOrg();
        const soleOwner = await seedMember(org.id, 'owner@acme.test', 'analyst');
        const project = await seedProject(org.id);
        await addProjectMembership(project.id, soleOwner.id, 'owner');

        await expect(service.remove(org.id, soleOwner.id)).rejects.toMatchObject({
          problem: {
            status: 409,
            detail:
              'Cannot remove this member; they are the only owner of one or more projects. Reassign ownership first.',
          },
        });

        const orgMembership = await prisma.membership.findUnique({
          where: { userId_orgId: { userId: soleOwner.id, orgId: org.id } },
        });
        expect(orgMembership).not.toBeNull();
        const projectMembership = await prisma.projectMembership.findUnique({
          where: { userId_projectId: { userId: soleOwner.id, projectId: project.id } },
        });
        expect(projectMembership).not.toBeNull();
      });

      it('allows removing a co-owner (another owner exists) and cascades their project memberships in that org', async () => {
        const org = await seedOrg();
        const coOwner = await seedMember(org.id, 'co-owner@acme.test', 'analyst');
        const otherOwner = await seedMember(org.id, 'other-owner@acme.test', 'analyst');
        const project = await seedProject(org.id);
        await addProjectMembership(project.id, coOwner.id, 'owner');
        await addProjectMembership(project.id, otherOwner.id, 'owner');

        await expect(service.remove(org.id, coOwner.id)).resolves.toBeUndefined();

        const orgMembership = await prisma.membership.findUnique({
          where: { userId_orgId: { userId: coOwner.id, orgId: org.id } },
        });
        expect(orgMembership).toBeNull();
        const projectMemberships = await prisma.projectMembership.findMany({
          where: { userId: coOwner.id, project: { orgId: org.id } },
        });
        expect(projectMemberships).toEqual([]);
        // The other owner's project membership must be untouched.
        const otherStillOwner = await prisma.projectMembership.findUnique({
          where: { userId_projectId: { userId: otherOwner.id, projectId: project.id } },
        });
        expect(otherStillOwner?.role).toBe('owner');
      });

      it('allows removing a member who owns nothing (regression of existing behavior)', async () => {
        const org = await seedOrg();
        const member = await seedMember(org.id, 'plain@acme.test', 'analyst');

        await expect(service.remove(org.id, member.id)).resolves.toBeUndefined();

        const orgMembership = await prisma.membership.findUnique({
          where: { userId_orgId: { userId: member.id, orgId: org.id } },
        });
        expect(orgMembership).toBeNull();
      });
    });
  });

  describe('remove — owner protection', () => {
    it('refuses to remove the current owner (409)', async () => {
      const org = await seedOrg();
      const owner = await seedMember(org.id, 'owner@acme.test', 'owner');

      await expect(service.remove(org.id, owner.id)).rejects.toMatchObject({
        problem: { status: 409 },
      });
      const stillThere = await prisma.membership.findUnique({
        where: { userId_orgId: { userId: owner.id, orgId: org.id } },
      });
      expect(stillThere).not.toBeNull();
    });
  });
});
