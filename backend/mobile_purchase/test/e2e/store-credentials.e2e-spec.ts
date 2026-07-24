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

describe('Store-credentials e2e — apps-list storeConnected', () => {
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
});
