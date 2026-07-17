import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
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
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
  });

  it('creates an entitlement and lists it', async () => {
    const ent = await service.create(projectId, { identifier: 'pro', displayName: 'Pro' });
    expect(ent.identifier).toBe('pro');
    const list = await service.list(projectId);
    expect(list.map((e) => e.id)).toContain(ent.id);
  });

  it('rejects a duplicate identifier for the same project', async () => {
    await service.create(projectId, { identifier: 'dup', displayName: 'Dup' });
    await expect(
      service.create(projectId, { identifier: 'dup', displayName: 'Dup2' }),
    ).rejects.toMatchObject({ problem: { status: 409 } });
  });

  it('404s removing a non-existent or cross-tenant entitlement', async () => {
    await expect(service.remove(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });

    const otherProjectId = randomUUID();
    const ent = await service.create(otherProjectId, { identifier: 'other', displayName: 'Other' });
    await expect(service.remove(projectId, ent.id)).rejects.toMatchObject({ problem: { status: 404 } });
  });
});
