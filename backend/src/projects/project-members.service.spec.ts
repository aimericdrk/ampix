import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { startPostgresContainer } from '../../test/integration/helpers/containers';
import { ProjectMembersService } from './project-members.service';
import { MembersService } from '../orgs/members.service';

// Container pull + `prisma migrate deploy` easily exceeds Jest's 5s default — see
// project-membership-backfill.spec.ts for the same rationale.
jest.setTimeout(180000);

/**
 * SECURITY-CRITICAL: this suite exercises the owner-safety rules against a REAL Postgres instance
 * (Testcontainers) rather than mocks. The last-owner invariant relies on `changeRole`/`remove`
 * running under SERIALIZABLE isolation to prevent write-skew (see `runSerializable` in
 * `orgs/members.service.ts` for the full explanation) — a mock `$transaction` can't reproduce
 * Postgres's predicate-lock-based conflict detection, so the concurrency test below needs the
 * genuine article to be meaningful.
 */
describe('ProjectMembersService (real Postgres)', () => {
  let prisma: PrismaClient;
  let service: ProjectMembersService;
  let container: Awaited<ReturnType<typeof startPostgresContainer>>['container'];

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new ProjectMembersService(prisma as unknown as PrismaService);
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

  async function seedOrgAndProject() {
    const org = await prisma.organization.create({ data: { name: 'Acme' } });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'App' } });
    return { org, project };
  }

  async function seedUser(email: string) {
    return prisma.user.create({ data: { email, passwordHash: 'x', name: email } });
  }

  /** Creates a user, makes them an org member, and (unless `projectRole` is omitted) a project
   *  member too — the shape almost every test needs. */
  async function seedMember(
    orgId: string,
    projectId: string,
    email: string,
    orgRole: 'admin' | 'analyst' | 'viewer',
    projectRole?: 'owner' | 'admin' | 'analyst' | 'viewer',
  ) {
    const user = await seedUser(email);
    await prisma.membership.create({ data: { userId: user.id, orgId, role: orgRole } });
    if (projectRole) {
      await prisma.projectMembership.create({
        data: { userId: user.id, projectId, role: projectRole },
      });
    }
    return user;
  }

  // Stand-in id for "some other, sufficiently-privileged actor" in tests that pass actorRole as a
  // literal and only care that the actor is NOT the target (so the self-role-change guard is not
  // what's under test). Any value distinct from the seeded target id works.
  const OTHER_ACTOR = 'other-actor-id';

  describe('list', () => {
    it('maps project memberships -> { user, role }', async () => {
      const { org, project } = await seedOrgAndProject();
      const owner = await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');

      const members = await service.list(project.id);

      expect(members).toEqual([
        { user: { id: owner.id, email: owner.email, name: owner.name }, role: 'owner' },
      ]);
    });
  });

  describe('assertMayTouch — owner-touching ops require an owner actor', () => {
    it('403s when an admin actor changes an owner target', async () => {
      const { org, project } = await seedOrgAndProject();
      const owner = await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');
      await seedMember(org.id, project.id, 'other-owner@acme.test', 'admin', 'owner'); // avoid last-owner 409 masking the 403

      await expect(
        service.changeRole(project.id, OTHER_ACTOR, 'admin', owner.id, 'admin'),
      ).rejects.toMatchObject({ problem: { status: 403 } });
    });

    it('403s when an admin actor sets a target to owner', async () => {
      const { org, project } = await seedOrgAndProject();
      await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');
      const analyst = await seedMember(org.id, project.id, 'analyst@acme.test', 'analyst', 'analyst');

      await expect(
        service.changeRole(project.id, OTHER_ACTOR, 'admin', analyst.id, 'owner'),
      ).rejects.toMatchObject({ problem: { status: 403 } });
    });

    it('allows an admin actor to change analyst -> viewer', async () => {
      const { org, project } = await seedOrgAndProject();
      await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');
      const analyst = await seedMember(org.id, project.id, 'analyst@acme.test', 'analyst', 'analyst');

      await expect(
        service.changeRole(project.id, OTHER_ACTOR, 'admin', analyst.id, 'viewer'),
      ).resolves.toEqual({ user_id: analyst.id, role: 'viewer' });
    });

    it('allows an owner actor to change owner -> admin when another owner exists', async () => {
      const { org, project } = await seedOrgAndProject();
      const target = await seedMember(org.id, project.id, 'owner1@acme.test', 'admin', 'owner');
      await seedMember(org.id, project.id, 'owner2@acme.test', 'admin', 'owner');

      await expect(
        service.changeRole(project.id, OTHER_ACTOR, 'owner', target.id, 'admin'),
      ).resolves.toEqual({ user_id: target.id, role: 'admin' });
    });

    it('allows an owner actor to mint a NEW owner via changeRole', async () => {
      const { org, project } = await seedOrgAndProject();
      await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');
      const analyst = await seedMember(org.id, project.id, 'analyst@acme.test', 'analyst', 'analyst');

      await expect(
        service.changeRole(project.id, OTHER_ACTOR, 'owner', analyst.id, 'owner'),
      ).resolves.toEqual({ user_id: analyst.id, role: 'owner' });
    });

    it('allows an owner actor to mint a NEW owner via add', async () => {
      const { org, project } = await seedOrgAndProject();
      await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');
      const newOrgMember = await seedUser('newbie@acme.test');
      await prisma.membership.create({
        data: { userId: newOrgMember.id, orgId: org.id, role: 'admin' },
      });

      await expect(
        service.add(project.id, 'owner', newOrgMember.id, 'owner'),
      ).resolves.toEqual({ user_id: newOrgMember.id, role: 'owner' });
    });
  });

  describe('self-role-change guard — an actor may never change their OWN role', () => {
    it('403s when an admin tries to promote THEMSELVES to owner', async () => {
      const { org, project } = await seedOrgAndProject();
      await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');
      const admin = await seedMember(org.id, project.id, 'admin@acme.test', 'admin', 'admin');

      await expect(
        service.changeRole(project.id, admin.id, 'admin', admin.id, 'owner'),
      ).rejects.toMatchObject({ problem: { status: 403 } });
      const unchanged = await prisma.projectMembership.findUnique({
        where: { userId_projectId: { userId: admin.id, projectId: project.id } },
      });
      expect(unchanged?.role).toBe('admin');
    });

    it('403s when an admin changes their OWN role (even a downgrade)', async () => {
      const { org, project } = await seedOrgAndProject();
      const admin = await seedMember(org.id, project.id, 'admin@acme.test', 'admin', 'admin');

      await expect(
        service.changeRole(project.id, admin.id, 'admin', admin.id, 'viewer'),
      ).rejects.toMatchObject({ problem: { status: 403 } });
      const unchanged = await prisma.projectMembership.findUnique({
        where: { userId_projectId: { userId: admin.id, projectId: project.id } },
      });
      expect(unchanged?.role).toBe('admin');
    });
  });

  describe('last-owner invariant', () => {
    it('409s when an owner actor demotes the last owner', async () => {
      const { org, project } = await seedOrgAndProject();
      const owner = await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');

      await expect(
        service.changeRole(project.id, OTHER_ACTOR, 'owner', owner.id, 'admin'),
      ).rejects.toMatchObject({ problem: { status: 409 } });
      const stillOwner = await prisma.projectMembership.findUnique({
        where: { userId_projectId: { userId: owner.id, projectId: project.id } },
      });
      expect(stillOwner?.role).toBe('owner');
    });

    it('409s when an owner actor removes the last owner', async () => {
      const { org, project } = await seedOrgAndProject();
      const owner = await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');

      await expect(service.remove(project.id, 'owner', owner.id)).rejects.toMatchObject({
        problem: { status: 409 },
      });
      const stillThere = await prisma.projectMembership.findUnique({
        where: { userId_projectId: { userId: owner.id, projectId: project.id } },
      });
      expect(stillThere).not.toBeNull();
    });

    it(
      'is atomic under a genuine Postgres write-skew race — SECURITY-CRITICAL: two concurrent ' +
        'demotions of the two co-owners must not both succeed',
      async () => {
        const { org, project } = await seedOrgAndProject();
        const ownerA = await seedMember(org.id, project.id, 'owner-a@acme.test', 'admin', 'owner');
        const ownerB = await seedMember(org.id, project.id, 'owner-b@acme.test', 'admin', 'owner');

        const [resultA, resultB] = await Promise.allSettled([
          service.changeRole(project.id, ownerB.id, 'owner', ownerA.id, 'admin'),
          service.changeRole(project.id, ownerA.id, 'owner', ownerB.id, 'admin'),
        ]);

        const outcomes = [resultA, resultB];
        const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
        const rejected = outcomes.filter((o) => o.status === 'rejected');
        // Exactly one demotion may win; the other must be rejected (409, having re-read state
        // after a serialization retry) so the project is never left with zero owners.
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
          problem: { status: 409 },
        });

        const owners = await prisma.projectMembership.count({
          where: { projectId: project.id, role: 'owner' },
        });
        expect(owners).toBe(1);
      },
    );
  });

  describe('add', () => {
    it('404s adding a user who is not an org member of the project org', async () => {
      const { org, project } = await seedOrgAndProject();
      await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');
      const otherOrg = await prisma.organization.create({ data: { name: 'Other Org' } });
      const outsider = await seedUser('outsider@other.test');
      await prisma.membership.create({
        data: { userId: outsider.id, orgId: otherOrg.id, role: 'admin' },
      });

      await expect(
        service.add(project.id, 'owner', outsider.id, 'viewer'),
      ).rejects.toMatchObject({
        problem: { status: 404, detail: 'User is not a member of this organization' },
      });
    });

    it('403s when an admin actor tries to add someone as owner', async () => {
      const { org, project } = await seedOrgAndProject();
      await seedMember(org.id, project.id, 'admin@acme.test', 'admin', 'admin');
      const newOrgMember = await seedUser('newbie@acme.test');
      await prisma.membership.create({
        data: { userId: newOrgMember.id, orgId: org.id, role: 'viewer' },
      });

      await expect(
        service.add(project.id, 'admin', newOrgMember.id, 'owner'),
      ).rejects.toMatchObject({ problem: { status: 403 } });
    });

    it('409s adding a user who is already a project member (re-roling must go through changeRole)', async () => {
      const { org, project } = await seedOrgAndProject();
      await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');
      const existingMember = await seedMember(
        org.id,
        project.id,
        'analyst@acme.test',
        'analyst',
        'analyst',
      );

      await expect(
        service.add(project.id, 'owner', existingMember.id, 'viewer'),
      ).rejects.toMatchObject({
        problem: { status: 409, detail: 'User is already a member of this project' },
      });
    });

    it('adds a new org member as a project member', async () => {
      const { org, project } = await seedOrgAndProject();
      await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');
      const newOrgMember = await seedUser('newbie@acme.test');
      await prisma.membership.create({
        data: { userId: newOrgMember.id, orgId: org.id, role: 'viewer' },
      });

      await expect(
        service.add(project.id, 'owner', newOrgMember.id, 'analyst'),
      ).resolves.toEqual({ user_id: newOrgMember.id, role: 'analyst' });
    });

    it(
      'maps a duplicate-add race (create() hits the PK unique constraint, Prisma P2002) to 409 ' +
        '— SECURITY/ROBUSTNESS: the loser of two concurrent adds gets a Conflict, not a raw 500',
      async () => {
        const { org, project } = await seedOrgAndProject();
        await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');
        // Existing project member — this is the row create() will collide with.
        const existingMember = await seedMember(
          org.id,
          project.id,
          'analyst@acme.test',
          'analyst',
          'analyst',
        );
        // Simulate the race window: force the pre-check to miss the existing row (as it would if
        // the other transaction hasn't committed yet at read time) so control reaches create(),
        // which then hits the real PK unique constraint in Postgres.
        const findUniqueSpy = jest
          .spyOn(prisma.projectMembership, 'findUnique')
          .mockResolvedValueOnce(null);

        await expect(
          service.add(project.id, 'owner', existingMember.id, 'viewer'),
        ).rejects.toMatchObject({
          problem: { status: 409, detail: 'User is already a member of this project' },
        });

        findUniqueSpy.mockRestore();
      },
    );

    it(
      'never leaves a ProjectMembership for a user whose org Membership was concurrently ' +
        'removed — SECURITY-CRITICAL: this is the write-skew race the whole-branch review ' +
        "flagged (add's org-check-then-create vs. the org removal's serializable cascade). " +
        "Like the last-owner race test above, this doesn't force a specific interleaving — it " +
        'fires both operations concurrently against the real Postgres instance and relies on ' +
        'SSI + runSerializable retries to make the outcome deterministic either way.',
      async () => {
        const { org, project } = await seedOrgAndProject();
        await seedMember(org.id, project.id, 'owner@acme.test', 'admin', 'owner');
        // A second org admin so the removal below never trips the last-admin guard itself and
        // the race under test stays isolated to the add/remove interleaving.
        await seedMember(org.id, project.id, 'admin2@acme.test', 'admin', 'admin');
        // The target is an org member but NOT yet a project member — exactly the state `add`
        // and a concurrent org-member removal race over.
        const target = await seedMember(org.id, project.id, 'target@acme.test', 'viewer');

        const membersService = new MembersService(prisma as unknown as PrismaService);

        const [addResult, removeResult] = await Promise.allSettled([
          service.add(project.id, 'owner', target.id, 'analyst'),
          membersService.remove(org.id, target.id),
        ]);

        // Target is neither the last admin nor a project owner, so the org removal must always
        // succeed regardless of how it interleaves with `add`.
        expect(removeResult.status).toBe('fulfilled');

        const orgMembership = await prisma.membership.findUnique({
          where: { userId_orgId: { userId: target.id, orgId: org.id } },
        });
        const projectMembership = await prisma.projectMembership.findUnique({
          where: { userId_projectId: { userId: target.id, projectId: project.id } },
        });

        // The invariant this feature depends on: ProjectMembership implies org Membership. The
        // org Membership is gone (removal always wins eventually), so the project membership
        // must be gone too — whether `add` lost the race outright (404, no longer an org member
        // once its serializable retry re-read the state) or won it and was then cascade-deleted
        // by the removal's own serializable transaction.
        expect(orgMembership).toBeNull();
        expect(projectMembership).toBeNull();
        if (addResult.status === 'rejected') {
          expect(addResult.reason).toMatchObject({
            problem: { status: 404, detail: 'User is not a member of this organization' },
          });
        }
      },
    );
  });

  describe('malformed userId', () => {
    it('404s for a non-UUID-shaped userId without querying Postgres', async () => {
      const { project } = await seedOrgAndProject();

      await expect(
        service.changeRole(project.id, OTHER_ACTOR, 'owner', 'not-a-uuid', 'admin'),
      ).rejects.toMatchObject({ problem: { status: 404 } });
      await expect(service.remove(project.id, 'owner', 'not-a-uuid')).rejects.toMatchObject({
        problem: { status: 404 },
      });
      await expect(service.add(project.id, 'owner', 'not-a-uuid', 'viewer')).rejects.toMatchObject(
        { problem: { status: 404 } },
      );
    });
  });
});
