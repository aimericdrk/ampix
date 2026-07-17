import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { startTestStack, TestStack } from './helpers/stack';

/**
 * §18 automatic screenshot pipeline (backend) end-to-end against a REAL Postgres (testcontainers)
 * through the production createApp wiring: the SDK-token ingest endpoint stores + dedupes + caps,
 * and the JWT + membership-gated read endpoints list screens and serve the JPEG bytes.
 *
 * SCREENSHOT_MAX_KB is pinned to 4 KB so the oversize case can use a small (8 KB) buffer.
 */

/** Tiny distinct "JPEG" (SOI … EOI with a unique marker byte) — content-type is what's validated. */
function jpeg(marker: number): Buffer {
  return Buffer.from([0xff, 0xd8, marker, 0xff, 0xd9]);
}

function uniqueEmail(): string {
  return `screens-${randomUUID()}@example.com`;
}

interface ScreenRow {
  screen_name: string;
  capture_count: number;
  latest_captured_at: string;
  width: number;
  height: number;
}

interface ShotOpts {
  screenName: string;
  appVersion: string;
  width?: number;
  height?: number;
  imageHash?: string;
  contentType?: string;
}

describe('automatic screenshots (e2e, contracts §18)', () => {
  let stack: TestStack;
  let server: Server;
  let accessToken: string;
  let ingestToken: string;
  let projectId: string;
  let orgId: string;

  beforeAll(async () => {
    stack = await startTestStack({
      JWT_ACCESS_SECRET: 'e2e-access-secret-value-e2e-access',
      JWT_REFRESH_SECRET: 'e2e-refresh-secret-value-e2e-refresh',
      SCREENSHOT_MAX_KB: '4',
    });
    server = stack.app.getHttpServer();

    const signup = await request(server)
      .post('/api/v1/auth/signup')
      .send({ email: uniqueEmail(), password: 'password123', name: 'Screens Tester' })
      .expect(200);
    accessToken = signup.body.access_token;

    const projects = await request(server)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    projectId = projects.body.projects[0].id;
    orgId = projects.body.projects[0].org_id;
    ingestToken = projects.body.projects[0].ingest_token;
  }, 180_000);

  afterAll(async () => {
    await stack.stop();
  });

  /** Posts a multipart screenshot. `token=''` sends no Authorization header. */
  function postShot(opts: ShotOpts, image: Buffer, token: string = ingestToken) {
    const t = request(server).post('/ingest/screenshots');
    if (token) t.set('Authorization', `Bearer ${token}`);
    return t
      .field('screen_name', opts.screenName)
      .field('app_version', opts.appVersion)
      .field('width', String(opts.width ?? 640))
      .field('height', String(opts.height ?? 1280))
      .field('image_hash', opts.imageHash ?? 'h')
      .attach('image', image, {
        filename: 'shot.jpg',
        contentType: opts.contentType ?? 'image/jpeg',
      });
  }

  function listScreens(token: string = accessToken) {
    return request(server)
      .get(`/api/v1/projects/${projectId}/screens`)
      .set('Authorization', `Bearer ${token}`);
  }

  function getImage(screenName: string, query: Record<string, string> = {}, token = accessToken) {
    return request(server)
      .get(`/api/v1/projects/${projectId}/screens/${screenName}/image`)
      .query(query)
      .set('Authorization', `Bearer ${token}`)
      .responseType('blob');
  }

  const findScreen = (rows: ScreenRow[], name: string): ScreenRow | undefined =>
    rows.find((s) => s.screen_name === name);

  it('stores a screenshot, lists it, and serves the exact bytes', async () => {
    await postShot({ screenName: 'home', appVersion: '1.0.0', imageHash: 'ha1' }, jpeg(1))
      .expect(202)
      .expect({ stored: true });

    const list = await listScreens().expect(200);
    const home = findScreen(list.body.screens, 'home');
    expect(home).toMatchObject({ screen_name: 'home', capture_count: 1, width: 640, height: 1280 });
    expect(typeof home!.latest_captured_at).toBe('string');

    const img = await getImage('home').expect(200).expect('Content-Type', /image\/jpeg/);
    expect(Buffer.compare(img.body, jpeg(1))).toBe(0);
  });

  it('re-posting the same (screen, app_version) replaces the bytes — still one row', async () => {
    await postShot({ screenName: 'home', appVersion: '1.0.0', imageHash: 'ha2' }, jpeg(2)).expect(202);

    const list = await listScreens().expect(200);
    expect(findScreen(list.body.screens, 'home')!.capture_count).toBe(1);

    const img = await getImage('home').expect(200);
    expect(Buffer.compare(img.body, jpeg(2))).toBe(0);
  });

  it('a different app_version adds a second capture; newest served by default, ?app_version selects one', async () => {
    await postShot({ screenName: 'home', appVersion: '2.0.0', imageHash: 'hb' }, jpeg(3)).expect(202);

    const list = await listScreens().expect(200);
    expect(findScreen(list.body.screens, 'home')!.capture_count).toBe(2);

    const newest = await getImage('home').expect(200);
    expect(Buffer.compare(newest.body, jpeg(3))).toBe(0);

    const v1 = await getImage('home', { app_version: '1.0.0' }).expect(200);
    expect(Buffer.compare(v1.body, jpeg(2))).toBe(0); // the replaced 1.0.0 bytes
  });

  it('rejects an oversize upload with 413', async () => {
    await postShot(
      { screenName: 'big', appVersion: '1.0.0', imageHash: 'hbig' },
      Buffer.alloc(8 * 1024, 0xff), // 8 KB > SCREENSHOT_MAX_KB=4
    ).expect(413);

    // Nothing stored for the rejected screen.
    await getImage('big').expect(404);
  });

  it('rejects a non-jpeg content type with 415', async () => {
    await postShot(
      { screenName: 'wrongtype', appVersion: '1.0.0', imageHash: 'hpng', contentType: 'image/png' },
      jpeg(1),
    ).expect(415);
  });

  it('requires a valid SDK token to ingest', async () => {
    await postShot({ screenName: 'noauth', appVersion: '1.0.0' }, jpeg(1), '').expect(401);
    await postShot({ screenName: 'noauth', appVersion: '1.0.0' }, jpeg(1), 'not-a-token').expect(401);
  });

  it('read endpoints enforce authentication and project membership', async () => {
    // Unauthenticated.
    await request(server).get(`/api/v1/projects/${projectId}/screens`).expect(401);

    // A user who is not a member of the project's org.
    const outsider = await request(server)
      .post('/api/v1/auth/signup')
      .send({ email: uniqueEmail(), password: 'password123', name: 'Outsider' })
      .expect(200);
    const outsiderToken = outsider.body.access_token;

    await listScreens(outsiderToken).expect(403);
    await getImage('home', {}, outsiderToken).expect(403);
  });

  it('the destructive DELETE rejects an org member who has no ProjectMembership (403)', async () => {
    // Wiring proof for the project-role guard on DELETE :screenName (analyst+). The outsider is an
    // ADMIN of the project's org — under the OLD org guard admin >= analyst would have DELETEd
    // (204) — but was never added to the project, so ProjectRolesGuard rejects with 403. This would
    // fail (return 204) if the guard were dropped or still resolved the org role.
    const invite = await request(server)
      .post(`/api/v1/orgs/${orgId}/invitations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'admin' })
      .expect(201);

    const outsider = await request(server)
      .post('/api/v1/auth/signup')
      .send({ email: uniqueEmail(), password: 'password123', name: 'Org Admin, No Project' })
      .expect(200);
    const outsiderToken = outsider.body.access_token;

    // Accept the org invite → org admin Membership only; NEVER a ProjectMembership.
    await request(server)
      .post(`/api/v1/invitations/${invite.body.token}/accept`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);

    await request(server)
      .delete(`/api/v1/projects/${projectId}/screens/home`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  it('404 when the requested screen has no capture', async () => {
    await getImage('does-not-exist').expect(404);
  });
});
