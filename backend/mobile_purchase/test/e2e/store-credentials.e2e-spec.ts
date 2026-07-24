import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ProjectAccessService, type ProjectRole } from '../../src/authz/project-access.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { startPostgresContainer } from '../integration/helpers/containers';
import { STORE_CREDENTIAL_VALIDATOR, InMemoryStoreCredentialValidator } from '../../src/catalog/store-credentials/store-credential-validator';

jest.setTimeout(180000);

/** Stands in for the real ProjectAccessService — see catalog.e2e-spec.ts. */
class FakeProjectAccessService {
  role: ProjectRole | null = 'admin';
  async getProjectRole(_projectId: string, _authHeader: string | undefined): Promise<ProjectRole | null> {
    return this.role;
  }
}

describe('Store-credentials e2e — apps-list storeConnected', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeAccess: FakeProjectAccessService;

  // One shared InMemory validator bound over STORE_CREDENTIAL_VALIDATOR for the whole file (the app
  // boots once — same single-instance pattern the refund e2e uses for GOOGLE_STORE_CLIENT). Its
  // default `validate()` resolution drives the set flow; the test asserts on liveVerified as a
  // boolean so it is agnostic to that default.
  const validator = new InMemoryStoreCredentialValidator();

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    process.env.DATABASE_URL = started.url.replace(/^postgres:\/\//, 'postgresql://');
    process.env.NODE_ENV = 'test';
    // 32 raw bytes, base64 — satisfies E1's Zod refine (base64 -> exactly 32 bytes). Without it the
    // set flow returns 503; with it the encrypt path runs.
    process.env.STORE_CREDENTIALS_ENC_KEY = Buffer.alloc(32, 7).toString('base64');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProjectAccessService)
      .useClass(FakeProjectAccessService)
      .overrideProvider(STORE_CREDENTIAL_VALIDATOR)
      .useValue(validator)
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
  });

  it('GET .../catalog/apps returns storeConnected per app (true when storeCredentials is set, false when null) and never the blob', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();

    const connectedApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Connected Android',
        platform: 'ANDROID',
        packageName: `com.connected.${randomUUID()}`,
        publicSdkKey: `mp_pub_${randomUUID()}`,
        // A dummy dot-joined ciphertext string — `storeConnected` is a pure null-ness check, so the
        // value is irrelevant and is never decrypted or returned.
        storeCredentials: 'aXY=.dGFn.Y2lwaGVy',
      },
    });
    const bareApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Bare iOS',
        platform: 'IOS',
        bundleId: `com.bare.${randomUUID()}`,
        publicSdkKey: `mp_pub_${randomUUID()}`,
      },
    });

    const res = await request(http)
      .get(`/api/v1/projects/${projectId}/catalog/apps`)
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    const connected = res.body.find((a: { id: string }) => a.id === connectedApp.id);
    const bare = res.body.find((a: { id: string }) => a.id === bareApp.id);
    expect(connected).toMatchObject({ storeConnected: true });
    expect(bare).toMatchObject({ storeConnected: false });
    // The encrypted blob is never echoed on the list.
    expect(connected).not.toHaveProperty('storeCredentials');
    expect(bare).not.toHaveProperty('storeCredentials');
  });

  /** A structurally-valid Google Play service-account blob (E2 rules: JSON, type==='service_account',
   * client_email, private_key, project_id). */
  function validGoogleBlob() {
    return {
      kind: 'google_play',
      serviceAccountJson: JSON.stringify({
        type: 'service_account',
        project_id: 'demo-project',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIfakekeymaterial\n-----END PRIVATE KEY-----\n',
        client_email: 'sa@demo-project.iam.gserviceaccount.com',
      }),
    };
  }

  async function seedAndroidApp(projectId: string) {
    return prisma.app.create({
      data: {
        projectId,
        name: 'Android',
        platform: 'ANDROID',
        packageName: `com.store.e2e.${randomUUID()}`,
        publicSdkKey: `mp_pub_${randomUUID()}`,
      },
    });
  }

  function credsPath(projectId: string, appId: string): string {
    return `/api/v1/projects/${projectId}/catalog/apps/${appId}/store-credentials`;
  }

  it('PUT store-credentials — 200 as admin: returns StoreCredentialStatus (connected), never the secret; blob is stored', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    const res = await request(http)
      .put(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .send(validGoogleBlob())
      .expect(200);

    expect(res.body).toMatchObject({ connected: true, platform: 'ANDROID' });
    expect(typeof res.body.liveVerified).toBe('boolean');
    // verifiedAt tracks liveVerified: a live-verified set stamps a date, a pending one stays null.
    if (res.body.liveVerified) {
      expect(typeof res.body.verifiedAt).toBe('string');
    } else {
      expect(res.body.verifiedAt).toBeNull();
    }
    // The secret is NEVER returned.
    expect(res.body).not.toHaveProperty('storeCredentials');
    expect(res.body).not.toHaveProperty('serviceAccountJson');

    // The encrypted blob was actually persisted (not the plaintext JSON).
    const persisted = await prisma.app.findUnique({ where: { id: androidApp.id } });
    expect(persisted?.storeCredentials).not.toBeNull();
    expect(persisted?.storeCredentials).not.toContain('service_account');

    // …and the apps list now reports storeConnected: true for it.
    const list = await request(http)
      .get(`/api/v1/projects/${projectId}/catalog/apps`)
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(list.body.find((a: { id: string }) => a.id === androidApp.id)).toMatchObject({ storeConnected: true });
  });

  it('PUT store-credentials — 403 as viewer (nothing written)', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    fakeAccess.role = 'viewer';
    await request(http)
      .put(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer viewer-token')
      .send(validGoogleBlob())
      .expect(403);

    const persisted = await prisma.app.findUnique({ where: { id: androidApp.id } });
    expect(persisted?.storeCredentials).toBeNull();
  });

  it('PUT store-credentials — 401 without an Authorization header', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    await request(http)
      .put(credsPath(projectId, androidApp.id))
      .send(validGoogleBlob())
      .expect(401);
  });

  it('PUT store-credentials — 404 for an unknown appId', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await request(http)
      .put(credsPath(projectId, randomUUID()))
      .set('Authorization', 'Bearer admin-token')
      .send(validGoogleBlob())
      .expect(404);
  });

  it('PUT store-credentials — 422 for a structurally-malformed blob', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    await request(http)
      .put(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .send({ kind: 'google_play', serviceAccountJson: '{ not valid json' })
      .expect(422);

    const persisted = await prisma.app.findUnique({ where: { id: androidApp.id } });
    expect(persisted?.storeCredentials).toBeNull();
  });

  it('GET store-credentials/status — 200 as viewer, connected reflects a prior admin set, secret never returned', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    fakeAccess.role = 'admin';
    await request(http)
      .put(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .send(validGoogleBlob())
      .expect(200);

    fakeAccess.role = 'viewer';
    const res = await request(http)
      .get(`${credsPath(projectId, androidApp.id)}/status`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);

    expect(res.body).toMatchObject({ connected: true, platform: 'ANDROID' });
    expect(res.body).not.toHaveProperty('storeCredentials');
    expect(res.body).not.toHaveProperty('serviceAccountJson');
  });

  it('DELETE store-credentials — 204 as admin, idempotent on repeat, clears storeConnected', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    fakeAccess.role = 'admin';
    await request(http)
      .put(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .send(validGoogleBlob())
      .expect(200);

    // viewer cannot disconnect
    fakeAccess.role = 'viewer';
    await request(http)
      .delete(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer viewer-token')
      .expect(403);

    fakeAccess.role = 'admin';
    await request(http)
      .delete(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .expect(204);

    expect((await prisma.app.findUnique({ where: { id: androidApp.id } }))?.storeCredentials).toBeNull();

    // idempotent: disconnecting an already-disconnected app is still a 204 no-op
    await request(http)
      .delete(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .expect(204);

    const status = await request(http)
      .get(`${credsPath(projectId, androidApp.id)}/status`)
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(status.body).toMatchObject({ connected: false });

    const list = await request(http)
      .get(`/api/v1/projects/${projectId}/catalog/apps`)
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(list.body.find((a: { id: string }) => a.id === androidApp.id)).toMatchObject({ storeConnected: false });
  });
});
