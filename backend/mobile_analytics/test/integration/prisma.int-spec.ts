import { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from './helpers/containers';

describe('Prisma schema (shared contracts §6)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  it('creates org → project → sdk token and enforces token uniqueness', async () => {
    const org = await prisma.organization.create({ data: { name: 'Acme' } });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'App' } });
    expect(project.timezone).toBe('UTC');

    const token = 'mam_' + 'a'.repeat(32);
    const created = await prisma.sdkToken.create({
      data: { projectId: project.id, token, label: 'default' },
    });
    expect(created.revokedAt).toBeNull();

    await expect(
      prisma.sdkToken.create({ data: { projectId: project.id, token, label: 'dup' } }),
    ).rejects.toThrow();
  });

  it('enforces the composite membership pk and role enum', async () => {
    const org = await prisma.organization.create({ data: { name: 'Org2' } });
    const user = await prisma.user.create({
      data: { email: 'a@b.co', passwordHash: 'x', name: 'A' },
    });
    await prisma.membership.create({ data: { userId: user.id, orgId: org.id, role: 'admin' } });
    await expect(
      prisma.membership.create({ data: { userId: user.id, orgId: org.id, role: 'viewer' } }),
    ).rejects.toThrow();
  });

  it('cascades project deletion to sdk tokens', async () => {
    const org = await prisma.organization.create({ data: { name: 'Org3' } });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'Doomed' } });
    await prisma.sdkToken.create({
      data: { projectId: project.id, token: 'mam_' + 'b'.repeat(32), label: 't' },
    });
    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.sdkToken.count({ where: { projectId: project.id } })).toBe(0);
  });
});
