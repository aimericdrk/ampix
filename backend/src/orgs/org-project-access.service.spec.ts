import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { startPostgresContainer } from '../../test/integration/helpers/containers';
import { OrgProjectAccessService } from './org-project-access.service';
import { ProjectMembersService } from '../projects/project-members.service';

// Container pull + `prisma migrate deploy` easily exceeds Jest's 5s default — see
// project-members.service.spec.ts for the same rationale.
jest.setTimeout(180000);

/**
 * SECURITY-CRITICAL: this suite exercises the self-escalation guard and the delegation to
 * ProjectMembersService's owner-safety rules against a REAL Postgres instance (Testcontainers)
 * rather than mocks — the same rationale as project-members.service.spec.ts.
 */
describe('OrgProjectAccessService (real Postgres)', () => {
  let prisma: PrismaClient;
  let service: OrgProjectAccessService;
  let container: Awaited<ReturnType<typeof startPostgresContainer>>['container'];

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    const projectMembers = new ProjectMembersService(prisma as unknown as PrismaService);
    service = new OrgProjectAccessService(prisma as unknown as PrismaService, projectMembers);
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

  async function addProjectMembership(
    projectId: string,
    userId: string,
    role: 'owner' | 'admin' | 'analyst' | 'viewer',
  ) {
    await prisma.projectMembership.create({ data: { projectId, userId, role } });
  }

  describe('list', () => {
    it('lists every org project with the target’s role (null where none)', async () => {
      const org = await seedOrg();
      const admin = await seedMember(org.id, 'admin@acme.test', 'admin');
      const target = await seedMember(org.id, 'target@acme.test', 'analyst');
      const projectA = await seedProject(org.id, 'App A');
      const projectB = await seedProject(org.id, 'App B');
      await addProjectMembership(projectA.id, admin.id, 'owner');
      await addProjectMembership(projectA.id, target.id, 'analyst');

      const { projects } = await service.list(org.id, target.id);

      expect(projects).toEqual(
        expect.arrayContaining([
          { projectId: projectA.id, name: projectA.name, role: 'analyst' },
          { projectId: projectB.id, name: projectB.name, role: null },
        ]),
      );
    });
  });

  describe('set', () => {
    it('an admin actor grants a member viewer access (add)', async () => {
      const org = await seedOrg();
      const admin = await seedMember(org.id, 'admin@acme.test', 'admin');
      const target = await seedMember(org.id, 'target@acme.test', 'analyst');
      const projectB = await seedProject(org.id, 'App B');

      const res = await service.set(org.id, admin.id, 'admin', target.id, projectB.id, 'viewer');

      expect(res).toEqual({ projectId: projectB.id, role: 'viewer' });
    });

    it('a null role removes access', async () => {
      const org = await seedOrg();
      const admin = await seedMember(org.id, 'admin@acme.test', 'admin');
      const target = await seedMember(org.id, 'target@acme.test', 'analyst');
      const projectA = await seedProject(org.id, 'App A');
      await addProjectMembership(projectA.id, target.id, 'analyst');

      await service.set(org.id, admin.id, 'admin', target.id, projectA.id, null);

      const row = await prisma.projectMembership.findUnique({
        where: { userId_projectId: { userId: target.id, projectId: projectA.id } },
      });
      expect(row).toBeNull();
    });

    it('blocks an admin from managing their OWN project access (403)', async () => {
      const org = await seedOrg();
      const admin = await seedMember(org.id, 'admin@acme.test', 'admin');
      const projectB = await seedProject(org.id, 'App B');

      await expect(
        service.set(org.id, admin.id, 'admin', admin.id, projectB.id, 'viewer'),
      ).rejects.toMatchObject({ problem: { status: 403 } });
    });

    it('lets the owner manage their own access (exempt from self-guard)', async () => {
      const org = await seedOrg();
      const owner = await seedMember(org.id, 'owner@acme.test', 'owner');
      const projectB = await seedProject(org.id, 'App B');

      const res = await service.set(org.id, owner.id, 'owner', owner.id, projectB.id, 'viewer');

      expect(res.role).toBe('viewer');
    });

    it('blocks an admin from touching a project-owner row (delegates to assertMayTouch, 403)', async () => {
      const org = await seedOrg();
      const admin = await seedMember(org.id, 'admin@acme.test', 'admin');
      const target = await seedMember(org.id, 'target@acme.test', 'analyst');
      const projectA = await seedProject(org.id, 'App A');
      await addProjectMembership(projectA.id, target.id, 'owner');

      await expect(
        service.set(org.id, admin.id, 'admin', target.id, projectA.id, 'viewer'),
      ).rejects.toMatchObject({ problem: { status: 403 } });
    });

    it('404s when the project is not in the org', async () => {
      const org = await seedOrg();
      const admin = await seedMember(org.id, 'admin@acme.test', 'admin');
      const target = await seedMember(org.id, 'target@acme.test', 'analyst');
      const otherOrg = await seedOrg();
      const otherOrgProject = await seedProject(otherOrg.id, 'Other App');

      await expect(
        service.set(org.id, admin.id, 'admin', target.id, otherOrgProject.id, 'viewer'),
      ).rejects.toMatchObject({ problem: { status: 404 } });
    });

    it('404s (not 500) when the projectId is malformed — short-circuits before Postgres', async () => {
      const org = await seedOrg();
      const admin = await seedMember(org.id, 'admin@acme.test', 'admin');
      const target = await seedMember(org.id, 'target@acme.test', 'analyst');

      // A non-uuid-shaped projectId must NOT reach Postgres (which would throw on the bad uuid
      // literal and surface as a generic 500) — it short-circuits to a 404 via isUuidShaped.
      await expect(
        service.set(org.id, admin.id, 'admin', target.id, 'not-a-uuid', 'viewer'),
      ).rejects.toMatchObject({ problem: { status: 404 } });
    });
  });
});
