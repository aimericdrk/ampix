import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ProjectAccessService, type ProjectRole } from '../../src/authz/project-access.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { GOOGLE_STORE_CLIENT } from '../../src/webhooks/google/google-store-client.factory';
import { GoogleCredentialsUnavailableError } from '../../src/webhooks/google/store-client.google-api';
import { InMemoryStoreClient } from '../../src/webhooks/google/store-client.in-memory';
import { startPostgresContainer } from '../integration/helpers/containers';

jest.setTimeout(180000);

/** Stands in for the real ProjectAccessService — see catalog.e2e-spec.ts. */
class FakeProjectAccessService {
  role: ProjectRole | null = 'admin';
  async getProjectRole(_projectId: string, _authHeader: string | undefined): Promise<ProjectRole | null> {
    return this.role;
  }
}

describe('Refund endpoint e2e — POST .../customers/:customerId/subscriptions/:subscriptionId/refund', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeAccess: FakeProjectAccessService;
  // The app boots ONCE per file (same harness as customer-writes.e2e-spec.ts), so per-test provider
  // swaps are off the table — one shared InMemoryStoreClient is bound over GOOGLE_STORE_CLIENT and
  // its behavior is flipped per test via failRevokeAndRefundWith, reset to success in beforeEach
  // (the same single-instance flip pattern fakeAccess.role already uses).
  const storeClient = new InMemoryStoreClient();

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    process.env.DATABASE_URL = started.url.replace(/^postgres:\/\//, 'postgresql://');
    process.env.NODE_ENV = 'test';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProjectAccessService)
      .useClass(FakeProjectAccessService)
      .overrideProvider(GOOGLE_STORE_CLIENT)
      .useValue(storeClient)
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

  beforeEach(() => {
    fakeAccess.role = 'admin';
    storeClient.failRevokeAndRefundWith(null); // default: the store call succeeds
  });

  function refundPath(projectId: string, customerId: string, subscriptionId: string): string {
    return `/api/v1/projects/${projectId}/customers/${customerId}/subscriptions/${subscriptionId}/refund`;
  }

  async function seedGoogleSubscription(projectId: string) {
    const customer = await prisma.customer.create({
      data: { projectId, appUserId: `refund-e2e-${randomUUID()}` },
    });
    const packageName = `com.refund.e2e.${randomUUID()}`;
    const sdkApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Android',
        platform: 'ANDROID',
        packageName,
        publicSdkKey: `mp_pub_${randomUUID()}`,
      },
    });
    const purchaseToken = `token-${randomUUID()}`;
    const subscription = await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: sdkApp.id,
        storeProductId: 'sub.monthly',
        store: 'PLAY_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        purchaseToken,
        purchasedAt: new Date('2026-07-01T00:00:00Z'),
        expiresAt: new Date('2026-08-01T00:00:00Z'),
      },
    });
    return { customer, packageName, purchaseToken, subscription };
  }

  it('200 as admin — body shows REVOKED + refundedAt, sub persisted as revoked, store double received (packageName, purchaseToken)', async () => {
    const projectId = randomUUID();
    const { customer, packageName, purchaseToken, subscription } = await seedGoogleSubscription(projectId);

    const res = await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, subscription.id))
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(res.body).toMatchObject({ id: subscription.id, status: 'REVOKED' });
    expect(typeof res.body.refundedAt).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.refundedAt))).toBe(false);

    const persisted = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    expect(persisted?.status).toBe('REVOKED');
    expect(persisted?.refundedAt).not.toBeNull();

    expect(storeClient.revokeAndRefundCalls).toContainEqual({ packageName, purchaseToken });
  });

  it('403 as viewer — nothing written, store not called', async () => {
    const projectId = randomUUID();
    const { customer, subscription } = await seedGoogleSubscription(projectId);
    const callsBefore = storeClient.revokeAndRefundCalls.length;

    fakeAccess.role = 'viewer';
    await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, subscription.id))
      .set('Authorization', 'Bearer viewer-token')
      .expect(403);

    const persisted = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    expect(persisted?.status).toBe('ACTIVE');
    expect(persisted?.refundedAt).toBeNull();
    expect(storeClient.revokeAndRefundCalls.length).toBe(callsBefore);
  });

  it('401 without an Authorization header', async () => {
    const projectId = randomUUID();
    const { customer, subscription } = await seedGoogleSubscription(projectId);

    await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, subscription.id))
      .expect(401);
  });

  it('404 for an unknown subscription id', async () => {
    const projectId = randomUUID();
    const { customer } = await seedGoogleSubscription(projectId);

    await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, randomUUID()))
      .set('Authorization', 'Bearer admin-token')
      .expect(404);
  });

  it('409 for a non-Google (APP_STORE) subscription — store not called', async () => {
    const projectId = randomUUID();
    const customer = await prisma.customer.create({
      data: { projectId, appUserId: `refund-e2e-${randomUUID()}` },
    });
    const iosApp = await prisma.app.create({
      data: {
        projectId,
        name: 'iOS',
        platform: 'IOS',
        bundleId: `com.refund.e2e.${randomUUID()}`,
        publicSdkKey: `mp_pub_${randomUUID()}`,
      },
    });
    const appleSub = await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: iosApp.id,
        storeProductId: 'sub.monthly',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        originalTransactionId: `orig-${randomUUID()}`,
        purchasedAt: new Date('2026-07-01T00:00:00Z'),
        expiresAt: new Date('2026-08-01T00:00:00Z'),
      },
    });
    const callsBefore = storeClient.revokeAndRefundCalls.length;

    const res = await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, appleSub.id))
      .set('Authorization', 'Bearer admin-token')
      .expect(409);

    expect(res.body.title).toBe('Refunds are only available for Google Play subscriptions.');
    expect(storeClient.revokeAndRefundCalls.length).toBe(callsBefore);

    const persisted = await prisma.subscription.findUnique({ where: { id: appleSub.id } });
    expect(persisted?.status).toBe('ACTIVE');
    expect(persisted?.refundedAt).toBeNull();
  });

  it('503 when the store client throws GoogleCredentialsUnavailableError — nothing written', async () => {
    const projectId = randomUUID();
    const { customer, packageName, subscription } = await seedGoogleSubscription(projectId);
    storeClient.failRevokeAndRefundWith(new GoogleCredentialsUnavailableError(packageName));

    const res = await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, subscription.id))
      .set('Authorization', 'Bearer admin-token')
      .expect(503);

    expect(res.body.title).toBe('Store credentials unavailable');

    const persisted = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    expect(persisted?.status).toBe('ACTIVE');
    expect(persisted?.refundedAt).toBeNull();
  });
});
