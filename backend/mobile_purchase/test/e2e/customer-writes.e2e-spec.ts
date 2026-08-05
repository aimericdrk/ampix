import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ProjectAccessService, type ProjectRole } from '../../src/authz/project-access.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { startPostgresContainer } from '../integration/helpers/containers';

jest.setTimeout(180000);

/** Stands in for the real ProjectAccessService — see catalog.e2e-spec.ts. */
class FakeProjectAccessService {
  role: ProjectRole | null = 'admin';
  async getProjectRole(_projectId: string, _authHeader: string | undefined): Promise<ProjectRole | null> {
    return this.role;
  }
}

describe('Customer write endpoints e2e — promotional entitlements + delete customer', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeAccess: FakeProjectAccessService;

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
    fakeAccess = app.get(ProjectAccessService) as unknown as FakeProjectAccessService;
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  async function seedCustomerAndEntitlement(projectId: string) {
    const customer = await prisma.customer.create({ data: { projectId, appUserId: `e2e-${randomUUID()}` } });
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'pro', displayName: 'Pro' },
    });
    return { customer, entitlement };
  }

  it('POST .../promotional-entitlements — 201 as admin (persists + returns entitlementIdentifier/expiresAt), 403 as viewer, 404 for a cross-project customer, 404 for a cross-project entitlement', async () => {
    fakeAccess.role = 'admin';
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const { customer, entitlement } = await seedCustomerAndEntitlement(projectId);

    const res = await request(http)
      .post(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements`)
      .set('Authorization', 'Bearer admin-token')
      .send({ entitlementId: entitlement.id, duration: 'monthly', note: 'support goodwill' })
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      entitlementIdentifier: 'pro',
      revokedAt: null,
      note: 'support goodwill',
    });
    expect(res.body.expiresAt).not.toBeNull();

    const persisted = await prisma.promotionalEntitlement.findUnique({ where: { id: res.body.id } });
    expect(persisted).toMatchObject({ projectId, customerId: customer.id, entitlementId: entitlement.id });

    fakeAccess.role = 'viewer';
    await request(http)
      .post(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements`)
      .set('Authorization', 'Bearer viewer-token')
      .send({ entitlementId: entitlement.id, duration: 'daily' })
      .expect(403);

    fakeAccess.role = 'admin';
    await request(http)
      .post(`/api/v1/projects/${projectId}/customers/${randomUUID()}/promotional-entitlements`)
      .set('Authorization', 'Bearer admin-token')
      .send({ entitlementId: entitlement.id, duration: 'daily' })
      .expect(404);

    await request(http)
      .post(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements`)
      .set('Authorization', 'Bearer admin-token')
      .send({ entitlementId: randomUUID(), duration: 'daily' })
      .expect(404);
  });

  it('DELETE .../promotional-entitlements/:grantId — 204 as admin (revokes, idempotent on repeat), 403 as viewer, 404 for a grant scoped to a different customer', async () => {
    fakeAccess.role = 'admin';
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const { customer, entitlement } = await seedCustomerAndEntitlement(projectId);
    const grant = await prisma.promotionalEntitlement.create({
      data: { projectId, customerId: customer.id, entitlementId: entitlement.id, expiresAt: null },
    });

    fakeAccess.role = 'viewer';
    await request(http)
      .delete(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements/${grant.id}`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(403);

    fakeAccess.role = 'admin';
    await request(http)
      .delete(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements/${grant.id}`)
      .set('Authorization', 'Bearer admin-token')
      .expect(204);

    const revoked = await prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } });
    expect(revoked?.revokedAt).not.toBeNull();

    // idempotent: revoking an already-revoked grant is still a no-op 204
    await request(http)
      .delete(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements/${grant.id}`)
      .set('Authorization', 'Bearer admin-token')
      .expect(204);

    const otherCustomer = await prisma.customer.create({ data: { projectId, appUserId: `other-${randomUUID()}` } });
    await request(http)
      .delete(`/api/v1/projects/${projectId}/customers/${otherCustomer.id}/promotional-entitlements/${grant.id}`)
      .set('Authorization', 'Bearer admin-token')
      .expect(404);
  });

  it('DELETE /customers/:customerId — 204 as admin (removes the customer, keeps transactions with customerId NULL), 403 as viewer, 404 for unknown id', async () => {
    fakeAccess.role = 'admin';
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const { customer } = await seedCustomerAndEntitlement(projectId);
    const sdkApp = await prisma.app.create({
      data: {
        projectId,
        name: 'iOS',
        platform: 'IOS',
        bundleId: `com.del.e2e.${randomUUID()}`,
        publicSdkKey: `mp_pub_${randomUUID()}`,
      },
    });
    const transaction = await prisma.transaction.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: sdkApp.id,
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        storeTransactionId: `txn-e2e-${randomUUID()}`,
        storeProductId: 'sub.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        purchasedAt: new Date(),
        rawPayload: {},
      },
    });

    fakeAccess.role = 'viewer';
    await request(http)
      .delete(`/api/v1/projects/${projectId}/customers/${customer.id}`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(403);

    fakeAccess.role = 'admin';
    await request(http)
      .delete(`/api/v1/projects/${projectId}/customers/${customer.id}`)
      .set('Authorization', 'Bearer admin-token')
      .expect(204);

    expect(await prisma.customer.findUnique({ where: { id: customer.id } })).toBeNull();
    const survivingTransaction = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(survivingTransaction?.customerId).toBeNull();

    await request(http)
      .delete(`/api/v1/projects/${projectId}/customers/${randomUUID()}`)
      .set('Authorization', 'Bearer admin-token')
      .expect(404);
  });
});
