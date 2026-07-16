import { randomUUID } from 'node:crypto';
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

  it('does not echo storeCredentials from create() or list()', async () => {
    const app = await service.create(projectId, { name: 'no-secrets', platform: 'IOS', bundleId: 'com.a.nosecrets' });
    expect(app.publicSdkKey).toMatch(/^mrc_pub_/);
    expect('storeCredentials' in app).toBe(false);

    const list = await service.list(projectId);
    const found = list.find((a) => a.id === app.id);
    expect(found).toBeDefined();
    expect(found?.publicSdkKey).toBe(app.publicSdkKey);
    expect(found && 'storeCredentials' in found).toBe(false);
  });

  it('remove() 404s for a cross-project or non-existent app', async () => {
    const otherOrg = await prisma.organization.create({ data: { name: 'O-cross-remove' } });
    const otherProject = await prisma.project.create({ data: { orgId: otherOrg.id, name: 'P-cross-remove' } });
    const app = await service.create(projectId, { name: 'cross-remove', platform: 'IOS', bundleId: 'com.a.crossremove' });

    await expect(service.remove(otherProject.id, app.id)).rejects.toMatchObject({ problem: { status: 404 } });
    await expect(service.remove(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('remove() 409s (not 500) when the app cascade-deletes a product that is referenced by a package (FK P2003, Package.product is onDelete: Restrict)', async () => {
    const app = await service.create(projectId, { name: 'fk-guard-app', platform: 'IOS', bundleId: 'com.a.fkguard' });
    const product = await prisma.product.create({
      data: {
        projectId,
        appId: app.id,
        storeProductId: 'fk-guard-product',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'FK Guard Product',
      },
    });
    const offering = await prisma.offering.create({
      data: { projectId, identifier: 'fk-guard-offering-app', displayName: 'FK Guard Offering' },
    });
    await prisma.package.create({
      data: { offeringId: offering.id, identifier: 'fk-guard-package-app', packageType: 'MONTHLY', productId: product.id },
    });

    await expect(service.remove(projectId, app.id)).rejects.toMatchObject({ problem: { status: 409 } });
  });
});
