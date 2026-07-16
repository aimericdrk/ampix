import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { EntitlementsService } from './entitlements.service';

jest.setTimeout(180000);

describe('EntitlementsService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: EntitlementsService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new EntitlementsService(prisma as never);
    const org = await prisma.organization.create({ data: { name: 'O' } });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'P' } });
    projectId = project.id;
  });
  afterAll(async () => { await prisma.$disconnect(); await container.stop(); });

  it('creates an entitlement and lists it', async () => {
    const ent = await service.create(projectId, { identifier: 'pro', displayName: 'Pro' });
    expect(ent.identifier).toBe('pro');
    const list = await service.list(projectId);
    expect(list.map((e) => e.id)).toContain(ent.id);
  });

  it('rejects a duplicate identifier for the same project', async () => {
    await service.create(projectId, { identifier: 'dup', displayName: 'Dup' });
    await expect(service.create(projectId, { identifier: 'dup', displayName: 'Dup2' })).rejects.toThrow();
  });

  it('remove() 404s for a cross-project or non-existent entitlement', async () => {
    const otherOrg = await prisma.organization.create({ data: { name: 'O-cross-remove' } });
    const otherProject = await prisma.project.create({ data: { orgId: otherOrg.id, name: 'P-cross-remove' } });
    const ent = await service.create(projectId, { identifier: 'cross-remove', displayName: 'CrossRemove' });

    await expect(service.remove(otherProject.id, ent.id)).rejects.toMatchObject({ problem: { status: 404 } });
    await expect(service.remove(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });
  });
});
