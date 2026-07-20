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

/** Stands in for the real ProjectAccessService, mirroring `catalog.e2e-spec.ts`'s pattern. */
class FakeProjectAccessService {
  role: ProjectRole | null = 'viewer';
  async getProjectRole(_projectId: string, _authHeader: string | undefined): Promise<ProjectRole | null> {
    return this.role;
  }
}

describe('Customers e2e — list + detail', () => {
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

  it('GET /customers — 200 as viewer, lists newest-first, search filters by appUserId', async () => {
    fakeAccess.role = 'viewer';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await prisma.customer.create({
      data: { projectId, appUserId: 'zed-user', createdAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    const target = await prisma.customer.create({
      data: { projectId, appUserId: 'annie-target', createdAt: new Date('2026-01-02T00:00:00.000Z') },
    });

    const res = await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .query({ search: 'annie' })
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);

    expect(res.body).toMatchObject({
      items: [
        { id: target.id, appUserId: 'annie-target', activeSubscriptionCount: 0, totalSpentCents: 0, currency: null },
      ],
      nextCursor: null,
    });
  });

  it('GET /customers — paginates: limit=1 returns nextCursor, a second call with it returns the rest', async () => {
    fakeAccess.role = 'viewer';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await prisma.customer.create({
      data: { projectId, appUserId: 'first', createdAt: new Date('2026-02-01T00:00:00.000Z') },
    });
    await prisma.customer.create({
      data: { projectId, appUserId: 'second', createdAt: new Date('2026-02-02T00:00:00.000Z') },
    });

    const page1 = await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .query({ limit: 1 })
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.items[0].appUserId).toBe('second');
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .query({ limit: 1, cursor: page1.body.nextCursor })
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].appUserId).toBe('first');
    expect(page2.body.nextCursor).toBeNull();
  });

  it('GET /customers — 400 for a limit over the max (100)', async () => {
    fakeAccess.role = 'viewer';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .query({ limit: 1000 })
      .set('Authorization', 'Bearer viewer-token')
      .expect(400);
  });

  it('GET /customers — 403 when the caller is not a project member', async () => {
    fakeAccess.role = null;
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .set('Authorization', 'Bearer stranger-token')
      .expect(403);
  });
});
