import { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { AppsService } from './apps.service';

jest.setTimeout(180000);

describe('AppsService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: AppsService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new AppsService(prisma as never);
    const org = await prisma.organization.create({ data: { name: 'O' } });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'P' } });
    projectId = project.id;
  });
  afterAll(async () => { await prisma.$disconnect(); await container.stop(); });

  it('creates an app with a generated public key and lists it', async () => {
    const app = await service.create(projectId, { name: 'iOS', platform: 'IOS', bundleId: 'com.a.b' });
    expect(app.publicSdkKey).toMatch(/^mrc_pub_/);
    const list = await service.list(projectId);
    expect(list.map((a) => a.id)).toContain(app.id);
  });

  it('rejects a duplicate bundleId for the same platform', async () => {
    await service.create(projectId, { name: 'dup', platform: 'IOS', bundleId: 'com.dup.app' });
    await expect(service.create(projectId, { name: 'dup2', platform: 'IOS', bundleId: 'com.dup.app' })).rejects.toThrow();
  });
});
