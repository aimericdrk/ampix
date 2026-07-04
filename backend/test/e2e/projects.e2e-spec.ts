import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startTestStack, TestStack } from './helpers/stack';

function uniqueEmail(): string {
  return `user-${randomUUID()}@example.com`;
}

async function signup(stack: TestStack, email: string) {
  return request(stack.app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', name: 'Test User' })
    .expect(200);
}

function makeEvent(eventName: string): Record<string, unknown> {
  return {
    insert_id: randomUUID(),
    event: eventName,
    distinct_id: 'u_42',
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: Date.now(),
    properties: {},
  };
}

describe('Projects & minimal analytics read (e2e, contracts §12)', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack({
      JWT_ACCESS_SECRET: 'e2e-access-secret-value-e2e-access',
      JWT_REFRESH_SECRET: 'e2e-refresh-secret-value-e2e-refresh',
    });
  }, 120_000);

  afterAll(async () => {
    await stack.stop();
  });

  describe('signup provisions a default workspace', () => {
    it('GET /api/v1/projects returns the auto-created Default project with an ingest_token', async () => {
      const email = uniqueEmail();
      const signupRes = await signup(stack, email);
      const accessToken = signupRes.body.access_token;

      const res = await request(stack.app.getHttpServer())
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.projects).toHaveLength(1);
      const [project] = res.body.projects;
      expect(project).toMatchObject({
        name: 'Default',
        timezone: 'UTC',
        org_name: "Test User's Workspace",
      });
      expect(project.id).toEqual(expect.any(String));
      expect(project.org_id).toEqual(expect.any(String));
      expect(project.ingest_token).toMatch(/^mam_[0-9a-f]{32}$/);
    });

    it('GET /api/v1/projects without an access token returns 401', async () => {
      await request(stack.app.getHttpServer()).get('/api/v1/projects').expect(401);
    });
  });

  describe('GET /api/v1/projects/:projectId/events/summary', () => {
    it('reflects real ingested event counts exactly (not just non-empty)', async () => {
      const email = uniqueEmail();
      const signupRes = await signup(stack, email);
      const accessToken = signupRes.body.access_token;

      const projectsRes = await request(stack.app.getHttpServer())
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const { id: projectId, ingest_token: ingestToken } = projectsRes.body.projects[0];

      // 5x checkout_completed + 3x product_viewed = 8 events total, across two event names.
      const events = [
        ...Array.from({ length: 5 }, () => makeEvent('checkout_completed')),
        ...Array.from({ length: 3 }, () => makeEvent('product_viewed')),
      ];
      await request(stack.app.getHttpServer())
        .post('/ingest/events')
        .set('Authorization', `Bearer ${ingestToken}`)
        .send({ events })
        .expect(202);

      const summaryRes = await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/events/summary`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(summaryRes.body).toEqual({
        project_id: projectId,
        total: 8,
        by_event: [
          { event: 'checkout_completed', count: 5 },
          { event: 'product_viewed', count: 3 },
        ],
      });
    });

    it('returns { total: 0, by_event: [] } for a project with no events', async () => {
      const email = uniqueEmail();
      const signupRes = await signup(stack, email);
      const accessToken = signupRes.body.access_token;

      const projectsRes = await request(stack.app.getHttpServer())
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const { id: projectId } = projectsRes.body.projects[0];

      const summaryRes = await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/events/summary`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(summaryRes.body).toEqual({ project_id: projectId, total: 0, by_event: [] });
    });

    it('a second user gets 403 (not data) reading the first user’s project — tenancy scoping is security-critical', async () => {
      const ownerEmail = uniqueEmail();
      const ownerSignup = await signup(stack, ownerEmail);
      const ownerToken = ownerSignup.body.access_token;
      const ownerProjects = await request(stack.app.getHttpServer())
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const { id: ownerProjectId, ingest_token: ownerIngestToken } = ownerProjects.body.projects[0];

      // Give the owner's project some real data, to prove a 403 leaks none of it.
      await request(stack.app.getHttpServer())
        .post('/ingest/events')
        .set('Authorization', `Bearer ${ownerIngestToken}`)
        .send({ events: [makeEvent('secret_event')] })
        .expect(202);

      const outsiderEmail = uniqueEmail();
      const outsiderSignup = await signup(stack, outsiderEmail);
      const outsiderToken = outsiderSignup.body.access_token;

      await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${ownerProjectId}/events/summary`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(403)
        .expect('Content-Type', /application\/problem\+json/);

      // And the outsider must not see the owner's project in their own listing either.
      const outsiderProjects = await request(stack.app.getHttpServer())
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(200);
      expect(
        outsiderProjects.body.projects.some((p: { id: string }) => p.id === ownerProjectId),
      ).toBe(false);
    });

    it('returns 404 for an unknown project id', async () => {
      const signupRes = await signup(stack, uniqueEmail());
      const accessToken = signupRes.body.access_token;

      await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${randomUUID()}/events/summary`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404)
        .expect('Content-Type', /application\/problem\+json/);
    });

    it('returns 401 when unauthenticated', async () => {
      await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${randomUUID()}/events/summary`)
        .expect(401);
    });
  });
});
