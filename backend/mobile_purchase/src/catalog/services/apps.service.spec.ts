import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
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
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
  });

  it('creates an app with a generated public key and lists it, without echoing storeCredentials', async () => {
    const app = await service.create(projectId, { name: 'iOS', platform: 'IOS', bundleId: 'com.a.b' });
    expect(app.publicSdkKey).toMatch(/^mp_pub_/);
    expect(app).not.toHaveProperty('storeCredentials');

    const list = await service.list(projectId);
    expect(list.map((a) => a.id)).toContain(app.id);
    expect(list.find((a) => a.id === app.id)).not.toHaveProperty('storeCredentials');
  });

  it('rejects a duplicate bundleId for the same platform', async () => {
    await service.create(projectId, { name: 'dup', platform: 'IOS', bundleId: 'com.dup.app' });
    await expect(
      service.create(projectId, { name: 'dup2', platform: 'IOS', bundleId: 'com.dup.app' }),
    ).rejects.toMatchObject({ problem: { status: 409 } });
  });

  it('404s removing a non-existent or cross-tenant app', async () => {
    await expect(service.remove(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });

    const otherProjectId = randomUUID();
    const app = await service.create(otherProjectId, { name: 'other', platform: 'ANDROID', packageName: 'com.other.app' });
    await expect(service.remove(projectId, app.id)).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('409s removing an app that is referenced by a package (via its product)', async () => {
    const app = await service.create(projectId, { name: 'ref', platform: 'IOS', bundleId: 'com.ref.app' });
    const product = await prisma.product.create({
      data: { projectId, appId: app.id, storeProductId: 'ref.product', type: 'CONSUMABLE', displayName: 'Ref' },
    });
    const offering = await prisma.offering.create({
      data: { projectId, identifier: 'ref-offering', displayName: 'Ref Offering' },
    });
    await prisma.package.create({
      data: { offeringId: offering.id, identifier: 'ref-package', packageType: 'MONTHLY', productId: product.id },
    });

    await expect(service.remove(projectId, app.id)).rejects.toMatchObject({ problem: { status: 409 } });
  });

  describe('findByBundleId', () => {
    it('resolves an iOS app by bundleId, returning just id + projectId', async () => {
      const app = await service.create(projectId, { name: 'iOS', platform: 'IOS', bundleId: 'com.myampix.resolve' });

      await expect(service.findByBundleId('com.myampix.resolve')).resolves.toEqual({
        id: app.id,
        projectId,
      });
    });

    it('returns null for an unknown bundleId', async () => {
      await expect(service.findByBundleId('com.unknown.bundle')).resolves.toBeNull();
    });

    it('does not resolve an ANDROID app even if packageName happens to match the bundleId query', async () => {
      await service.create(projectId, { name: 'Android', platform: 'ANDROID', packageName: 'com.myampix.cross' });
      await expect(service.findByBundleId('com.myampix.cross')).resolves.toBeNull();
    });
  });

  describe('findByPackageName', () => {
    it('resolves an Android app by packageName, returning just id + projectId', async () => {
      const app = await service.create(projectId, { name: 'Android', platform: 'ANDROID', packageName: 'com.myampix.resolve' });

      await expect(service.findByPackageName('com.myampix.resolve')).resolves.toEqual({
        id: app.id,
        projectId,
      });
    });

    it('returns null for an unknown packageName', async () => {
      await expect(service.findByPackageName('com.unknown.package')).resolves.toBeNull();
    });

    it('does not resolve an IOS app even if bundleId happens to match the packageName query', async () => {
      await service.create(projectId, { name: 'iOS', platform: 'IOS', bundleId: 'com.myampix.cross2' });
      await expect(service.findByPackageName('com.myampix.cross2')).resolves.toBeNull();
    });
  });
});
