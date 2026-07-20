import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ProjectAccessService, type ProjectRole } from '../../src/authz/project-access.service';
import { startPostgresContainer } from '../integration/helpers/containers';

jest.setTimeout(180000);

class FakeProjectAccessService {
  role: ProjectRole | null = 'viewer';
  async getProjectRole(_projectId: string, _authHeader: string | undefined): Promise<ProjectRole | null> {
    return this.role;
  }
}

describe('Metrics e2e — module wiring + ProjectAccessGuard', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
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
    fakeAccess = app.get(ProjectAccessService) as unknown as FakeProjectAccessService;
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  const routes = ['revenue', 'mrr', 'active-subscriptions', 'summary'];

  it('viewer gets 200 with the documented shape on every metrics route (empty project -> zeros)', async () => {
    fakeAccess.role = 'viewer';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    const revenue = await request(http)
      .get(`/api/v1/projects/${projectId}/metrics/revenue`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
    expect(revenue.body).toEqual({ currency: null, totalCents: 0, series: expect.any(Array), byCurrency: [] });

    const mrr = await request(http)
      .get(`/api/v1/projects/${projectId}/metrics/mrr`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
    expect(mrr.body).toMatchObject({ currency: null, mrrCents: 0, unattributedActiveCount: 0, approximate: true });

    const active = await request(http)
      .get(`/api/v1/projects/${projectId}/metrics/active-subscriptions`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
    expect(active.body).toMatchObject({ current: 0, approximate: true });

    const summary = await request(http)
      .get(`/api/v1/projects/${projectId}/metrics/summary`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
    expect(summary.body).toEqual({
      mrr_cents: 0,
      active: 0,
      in_trial: 0,
      grace: 0,
      new_subscriptions: 0,
      churned: 0,
      trials_started: 0,
      trials_converted: 0,
      by_day: expect.any(Array),
      by_product: [],
      by_store: [],
      churn_reasons: [],
      recent_events: [],
    });
  });

  it('missing Authorization header -> 401 on every metrics route (guard runs before the handler)', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    for (const route of routes) {
      await request(http).get(`/api/v1/projects/${projectId}/metrics/${route}`).expect(401);
    }
  });

  it('denied role -> 403', async () => {
    fakeAccess.role = null;
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${randomUUID()}/metrics/revenue`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${randomUUID()}/metrics/summary`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(403);
  });

  it('summary — 400 when from is after to', async () => {
    fakeAccess.role = 'viewer';
    const projectId = randomUUID();
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/metrics/summary`)
      .query({ from: '2026-07-10T00:00:00Z', to: '2026-07-01T00:00:00Z' })
      .set('Authorization', 'Bearer viewer-token')
      .expect(400);
  });
});
