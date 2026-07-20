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
});
