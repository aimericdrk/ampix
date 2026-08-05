import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { createApp } from '../../src/main';
import { startPostgresContainer } from '../integration/helpers/containers';

jest.setTimeout(180000);

const ALLOWED_ORIGIN = 'http://localhost:5173';
const DISALLOWED_ORIGIN = 'https://evil.example';

describe('CORS boot — mobile_purchase allows the configured dashboard origin', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    // testcontainers emits `postgres://`; app-config's Zod schema requires `postgresql://`.
    process.env.DATABASE_URL = started.url.replace(/^postgres:\/\//, 'postgresql://');
    process.env.NODE_ENV = 'test';
    process.env.DASHBOARD_ORIGINS = `${ALLOWED_ORIGIN},https://app.myampix.example`;

    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
    delete process.env.DASHBOARD_ORIGINS;
  });

  it('answers the OPTIONS preflight for an allowed origin before the guard (204 + credentialed CORS headers)', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/projects/proj-1/metrics/revenue')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization');
  });

  it('stamps the credentialed allow-origin header on an actual request from an allowed origin', async () => {
    // Auth is not the subject here (no fake ProjectAccessService wired); the CORS layer must still
    // stamp allow-origin regardless of the eventual 401/403/404 the request resolves to.
    const res = await request(app.getHttpServer())
      .get('/api/v1/projects/proj-1/metrics/revenue')
      .set('Origin', ALLOWED_ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not authorize a disallowed origin (no allow-origin header)', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/projects/proj-1/metrics/revenue')
      .set('Origin', DISALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
