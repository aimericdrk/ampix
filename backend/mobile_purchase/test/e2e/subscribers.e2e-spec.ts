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

/** Stands in for the real ProjectAccessService — see catalog.e2e-spec.ts. Not exercised by
 * `GET /v1/subscribers/:appUserId` (PublicApiKeyGuard only, no ProjectAccessGuard), but AppModule
 * still wires AuthzModule, so it needs a working provider to boot. */
class FakeProjectAccessService {
  role: ProjectRole | null = 'admin';
  async getProjectRole(_projectId: string, _authHeader: string | undefined): Promise<ProjectRole | null> {
    return this.role;
  }
}

describe('Subscribers e2e — GET /v1/subscribers/:appUserId', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    process.env.DATABASE_URL = started.url.replace(/^postgres:\/\//, 'postgresql://');
    process.env.NODE_ENV = 'test';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProjectAccessService)
      .useClass(FakeProjectAccessService)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  async function createApp(projectId: string, overrides: Partial<{ bundleId: string; packageName: string }> = {}) {
    return prisma.app.create({
      data: {
        projectId,
        name: 'iOS',
        platform: 'IOS',
        bundleId: overrides.bundleId ?? `com.e2e.${randomUUID()}`,
        packageName: overrides.packageName ?? null,
        publicSdkKey: generatePublicSdkKey(),
      },
    });
  }

  it('returns CustomerInfo with an active entitlement for a subscriber with an ACTIVE subscription', async () => {
    const projectId = randomUUID();
    const sdkApp = await createApp(projectId);

    const product = await prisma.product.create({
      data: {
        projectId,
        appId: sdkApp.id,
        storeProductId: 'sdk.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Monthly',
      },
    });
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'premium', displayName: 'Premium' },
    });
    await prisma.productEntitlement.create({ data: { productId: product.id, entitlementId: entitlement.id } });

    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'active-subscriber' } });
    await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: sdkApp.id,
        productId: product.id,
        storeProductId: 'sdk.monthly',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        periodType: 'NORMAL',
        originalTransactionId: `orig-${randomUUID()}`,
        purchasedAt: new Date('2026-05-01T00:00:00.000Z'),
        originalPurchasedAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        autoRenewStatus: true,
      },
    });

    const res = await request(app.getHttpServer())
      .get('/v1/subscribers/active-subscriber')
      .set('Authorization', `Bearer ${sdkApp.publicSdkKey}`)
      .expect(200);

    expect(res.body.customerInfo.entitlements.active.premium).toMatchObject({
      isActive: true,
      willRenew: true,
      store: 'app_store',
      productIdentifier: 'sdk.monthly',
      expirationDate: '2099-01-01T00:00:00.000Z',
    });
  });

  it('returns 200 with EMPTY CustomerInfo for a brand-new, unknown-but-valid app_user_id, and creates the Customer', async () => {
    const projectId = randomUUID();
    const sdkApp = await createApp(projectId);

    const res = await request(app.getHttpServer())
      .get('/v1/subscribers/never-seen-before-user')
      .set('Authorization', `Bearer ${sdkApp.publicSdkKey}`)
      .expect(200);

    expect(res.body.customerInfo.entitlements.active).toEqual({});
    expect(res.body.customerInfo.entitlements.all).toEqual({});
    expect(res.body.customerInfo.subscriptions).toEqual([]);

    const created = await prisma.customer.findUnique({
      where: { projectId_appUserId: { projectId, appUserId: 'never-seen-before-user' } },
    });
    expect(created).not.toBeNull();
  });

  it('400s a reserved app_user_id and persists no Customer', async () => {
    const projectId = randomUUID();
    const sdkApp = await createApp(projectId);

    await request(app.getHttpServer())
      .get('/v1/subscribers/null')
      .set('Authorization', `Bearer ${sdkApp.publicSdkKey}`)
      .expect(400);

    const created = await prisma.customer.findUnique({
      where: { projectId_appUserId: { projectId, appUserId: 'null' } },
    });
    expect(created).toBeNull();
  });

  it("400s an app_user_id equal to the App's own bundleId (design §3 reserved-store-id rule)", async () => {
    const projectId = randomUUID();
    const bundleId = `com.e2e.reserved.${randomUUID()}`;
    const sdkApp = await createApp(projectId, { bundleId });

    await request(app.getHttpServer())
      .get(`/v1/subscribers/${bundleId}`)
      .set('Authorization', `Bearer ${sdkApp.publicSdkKey}`)
      .expect(400);

    const created = await prisma.customer.findUnique({
      where: { projectId_appUserId: { projectId, appUserId: bundleId } },
    });
    expect(created).toBeNull();
  });

  it('enforces key/project isolation: App A cannot read App B project’s customer data for the same app_user_id', async () => {
    const projectA = randomUUID();
    const projectB = randomUUID();
    const appA = await createApp(projectA);
    const appB = await createApp(projectB);

    // Project B has a customer with an active entitlement under the shared app_user_id string.
    const productB = await prisma.product.create({
      data: {
        projectId: projectB,
        appId: appB.id,
        storeProductId: 'b.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'B Monthly',
      },
    });
    const entitlementB = await prisma.entitlement.create({
      data: { projectId: projectB, identifier: 'b-premium', displayName: 'B Premium' },
    });
    await prisma.productEntitlement.create({ data: { productId: productB.id, entitlementId: entitlementB.id } });
    const customerB = await prisma.customer.create({
      data: { projectId: projectB, appUserId: 'shared-app-user-id' },
    });
    await prisma.subscription.create({
      data: {
        projectId: projectB,
        customerId: customerB.id,
        appId: appB.id,
        productId: productB.id,
        storeProductId: 'b.monthly',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        periodType: 'NORMAL',
        originalTransactionId: `orig-b-${randomUUID()}`,
        purchasedAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        autoRenewStatus: true,
      },
    });

    // App A reads the SAME app_user_id string with its OWN key — must see an empty, project-A view.
    const res = await request(app.getHttpServer())
      .get('/v1/subscribers/shared-app-user-id')
      .set('Authorization', `Bearer ${appA.publicSdkKey}`)
      .expect(200);

    expect(res.body.customerInfo.entitlements.active).toEqual({});
    expect(res.body.customerInfo.entitlements.all).toEqual({});

    const createdInA = await prisma.customer.findUnique({
      where: { projectId_appUserId: { projectId: projectA, appUserId: 'shared-app-user-id' } },
    });
    expect(createdInA).not.toBeNull();
  });

  it('401s a missing or invalid Bearer key', async () => {
    await request(app.getHttpServer()).get('/v1/subscribers/some-user').expect(401);
    await request(app.getHttpServer())
      .get('/v1/subscribers/some-user')
      .set('Authorization', 'Bearer not-a-real-key')
      .expect(401);
  });
});
