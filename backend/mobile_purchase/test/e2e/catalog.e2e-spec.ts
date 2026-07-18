import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ProjectAccessService, type ProjectRole } from '../../src/authz/project-access.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { generatePublicSdkKey } from '../../src/catalog/support/key-generator';
import { startPostgresContainer } from '../integration/helpers/containers';

jest.setTimeout(180000);

/**
 * Stands in for the real ProjectAccessService (which calls out to the analytics backend). Its
 * `role` is mutated per-test to drive ProjectAccessGuard through every branch without a live
 * analytics instance — proving the guard + module wiring, not the cross-service HTTP call.
 */
class FakeProjectAccessService {
  role: ProjectRole | null = 'admin';
  async getProjectRole(_projectId: string, _authHeader: string | undefined): Promise<ProjectRole | null> {
    return this.role;
  }
}

describe('Catalog e2e — module wiring, both guards, public SDK offerings endpoint', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeAccess: FakeProjectAccessService;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    // testcontainers' getConnectionUri() emits `postgres://`; app-config's Zod schema requires
    // `postgresql://`.
    process.env.DATABASE_URL = started.url.replace(/^postgres:\/\//, 'postgresql://');
    process.env.NODE_ENV = 'test';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProjectAccessService)
      .useClass(FakeProjectAccessService)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    fakeAccess = app.get(ProjectAccessService) as unknown as FakeProjectAccessService;
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  it('proves the module is mounted (not 404) and ProjectAccessGuard is enforced: admin creates+persists, viewer gets 403, viewer can still read', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();

    fakeAccess.role = 'admin';
    const createRes = await request(http)
      .post(`/api/v1/projects/${projectId}/catalog/apps`)
      .set('Authorization', 'Bearer admin-token')
      .send({ name: 'iOS App', platform: 'IOS', bundleId: `com.e2e.${randomUUID()}` })
      .expect(201);
    expect(createRes.body.id).toEqual(expect.any(String));

    const persisted = await prisma.app.findUnique({ where: { id: createRes.body.id } });
    expect(persisted).not.toBeNull();
    expect(persisted?.projectId).toBe(projectId);

    fakeAccess.role = 'viewer';
    await request(http)
      .post(`/api/v1/projects/${projectId}/catalog/apps`)
      .set('Authorization', 'Bearer viewer-token')
      .send({ name: 'Blocked App', platform: 'ANDROID', packageName: `com.e2e.blocked.${randomUUID()}` })
      .expect(403);

    await request(http)
      .get(`/api/v1/projects/${projectId}/catalog/apps`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
  });

  it('proves the public SDK endpoint: GET /v1/offerings resolves the current offering by publicSdkKey; a bad key -> 401', async () => {
    fakeAccess.role = 'admin';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    const sdkApp = await prisma.app.create({
      data: {
        projectId,
        name: 'SDK App',
        platform: 'IOS',
        bundleId: `com.sdk.${randomUUID()}`,
        publicSdkKey: generatePublicSdkKey(),
      },
    });
    const product = await prisma.product.create({
      data: {
        projectId,
        appId: sdkApp.id,
        storeProductId: 'sdk.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Monthly',
        priceCents: 999,
        currency: 'USD',
        durationIso8601: 'P1M',
      },
    });
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'pro', displayName: 'Pro' },
    });
    await prisma.productEntitlement.create({ data: { productId: product.id, entitlementId: entitlement.id } });
    const offering = await prisma.offering.create({
      data: { projectId, identifier: 'default', displayName: 'Default', isCurrent: true },
    });
    await prisma.package.create({
      data: { offeringId: offering.id, identifier: '$rc_monthly', packageType: 'MONTHLY', productId: product.id },
    });

    const res = await request(http)
      .get('/v1/offerings')
      .set('Authorization', `Bearer ${sdkApp.publicSdkKey}`)
      .expect(200);

    expect(res.body.current).toMatchObject({
      identifier: 'default',
      packages: [
        expect.objectContaining({
          identifier: '$rc_monthly',
          product: expect.objectContaining({ storeProductId: 'sdk.monthly', entitlements: ['pro'] }),
        }),
      ],
    });

    await request(http).get('/v1/offerings').set('Authorization', 'Bearer not-a-real-key').expect(401);
    await request(http).get('/v1/offerings').expect(401);
  });

  it('PATCH products/:productId — 200 as admin (updates editable fields), 403 as viewer, 404 for unknown id', async () => {
    fakeAccess.role = 'admin';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    const patchApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Patch App',
        platform: 'IOS',
        bundleId: `com.patch.${randomUUID()}`,
        publicSdkKey: generatePublicSdkKey(),
      },
    });
    const product = await prisma.product.create({
      data: {
        projectId,
        appId: patchApp.id,
        storeProductId: 'patch.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Monthly',
      },
    });

    const res = await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/products/${product.id}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ displayName: 'Monthly Plus', priceCents: 1999, currency: 'USD' })
      .expect(200);
    expect(res.body).toMatchObject({ id: product.id, displayName: 'Monthly Plus', priceCents: 1999, currency: 'USD' });

    fakeAccess.role = 'viewer';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/products/${product.id}`)
      .set('Authorization', 'Bearer viewer-token')
      .send({ displayName: 'Blocked' })
      .expect(403);

    fakeAccess.role = 'admin';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/products/${randomUUID()}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ displayName: 'Nope' })
      .expect(404);
  });

  it('PATCH entitlements/:entitlementId — 200 as admin (updates displayName), 403 as viewer, 404 for unknown id', async () => {
    fakeAccess.role = 'admin';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'patch-ent', displayName: 'Before' },
    });

    const res = await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/entitlements/${entitlement.id}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ displayName: 'After' })
      .expect(200);
    expect(res.body).toMatchObject({ id: entitlement.id, displayName: 'After', identifier: 'patch-ent' });

    fakeAccess.role = 'viewer';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/entitlements/${entitlement.id}`)
      .set('Authorization', 'Bearer viewer-token')
      .send({ displayName: 'Blocked' })
      .expect(403);

    fakeAccess.role = 'admin';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/entitlements/${randomUUID()}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ displayName: 'Nope' })
      .expect(404);
  });
});
