import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import type { AppConfig } from '../../config/app-config';
import { decryptStoreCredentials } from '../../common/crypto/store-credentials-cipher';
import {
  InMemoryStoreCredentialValidator,
  StoreValidationUnavailableError,
} from './store-credential-validator';
import { StoreCredentialsService } from './store-credentials.service';

jest.setTimeout(180000);

/** Fixed reference clock (design §1.4 — `nowMs` is injected, never `Date.now()`), so `verifiedAt`
 * is deterministic on the live-verified happy path. */
const NOW_MS = Date.parse('2026-07-25T12:00:00.000Z');

/** A valid AES-256-GCM key (base64 of exactly 32 bytes) for E1's cipher. */
const TEST_ENC_KEY = Buffer.alloc(32, 7).toString('base64');

/** Minimal AppConfig — the service only reads `storeCredentialsEncKey`. Cast keeps the fixture from
 * having to spell out every unrelated config field (mirrors the hand-built-fixture pattern the
 * config's own comments sanction). */
function makeConfig(storeCredentialsEncKey?: string): AppConfig {
  return { storeCredentialsEncKey } as unknown as AppConfig;
}

/** Structurally-valid Google Play service-account JSON (E2 rules: type==='service_account' +
 * client_email + private_key + project_id). */
const VALID_SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'demo-proj',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIfakekeymaterial\n-----END PRIVATE KEY-----\n',
  client_email: 'svc@demo-proj.iam.gserviceaccount.com',
});
const GOOGLE_INPUT = { kind: 'google_play', serviceAccountJson: VALID_SERVICE_ACCOUNT_JSON };

/** Structurally-valid Apple App Store Connect credential (E2 rules: 10-char keyId, UUID issuerId,
 * PEM p8, all-digit appAppleId). */
const APPLE_INPUT = {
  kind: 'app_store',
  ascIssuerId: '69a6de70-1234-47e3-e053-5b8c7c11a4d1',
  ascKeyId: 'ABCDE12345',
  ascPrivateKeyP8: '-----BEGIN PRIVATE KEY-----\nMIGTfakep8material\n-----END PRIVATE KEY-----\n',
  appAppleId: '1234567890',
};

describe('StoreCredentialsService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let validator: InMemoryStoreCredentialValidator;
  let service: StoreCredentialsService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
    validator = new InMemoryStoreCredentialValidator();
    service = new StoreCredentialsService(prisma as never, makeConfig(TEST_ENC_KEY), validator);
  });

  async function seedAndroidApp() {
    return prisma.app.create({
      data: {
        projectId,
        name: 'Android',
        platform: 'ANDROID',
        packageName: `com.demo.${randomUUID()}`,
        publicSdkKey: `mp_pub_test_${randomUUID()}`,
      },
    });
  }

  async function seedIosApp() {
    return prisma.app.create({
      data: {
        projectId,
        name: 'iOS',
        platform: 'IOS',
        bundleId: `com.demo.ios.${randomUUID()}`,
        publicSdkKey: `mp_pub_test_${randomUUID()}`,
      },
    });
  }

  it('set (Google, live-verified): stores the encrypted blob + status columns, calls the validator once, returns connected/liveVerified without the secret', async () => {
    const app = await seedAndroidApp();
    validator.resolveWith(true);

    const status = await service.set(projectId, app.id, GOOGLE_INPUT, NOW_MS);

    expect(status).toEqual({
      connected: true,
      platform: 'ANDROID',
      liveVerified: true,
      verifiedAt: new Date(NOW_MS),
    });
    // NEVER the secret.
    expect(status).not.toHaveProperty('serviceAccountJson');
    expect(status).not.toHaveProperty('storeCredentials');

    expect(validator.validateCalls).toHaveLength(1);
    expect(validator.validateCalls[0].app.packageName).toBe(app.packageName);
    expect(validator.validateCalls[0].blob).toEqual(GOOGLE_INPUT);

    const reloaded = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    expect(reloaded.storeCredentials).not.toBeNull();
    expect(reloaded.storeCredentials).not.toContain('service_account'); // encrypted, not plaintext
    expect(reloaded.storeCredentialsLiveVerified).toBe(true);
    expect(reloaded.storeCredentialsVerifiedAt).toEqual(new Date(NOW_MS));
  });

  it('set (Apple, live-verified): routes IOS -> app_store and persists', async () => {
    const app = await seedIosApp();
    validator.resolveWith(true);

    const status = await service.set(projectId, app.id, APPLE_INPUT, NOW_MS);

    expect(status).toEqual({
      connected: true,
      platform: 'IOS',
      liveVerified: true,
      verifiedAt: new Date(NOW_MS),
    });
    const reloaded = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    expect(reloaded.storeCredentials).not.toBeNull();
    expect(reloaded.storeCredentialsLiveVerified).toBe(true);
  });

  it('set (pending): a StoreValidationUnavailableError from the validator stores the blob but marks liveVerified=false / verifiedAt=null', async () => {
    const app = await seedAndroidApp();
    validator.failWith(new StoreValidationUnavailableError('live validation unavailable'));

    const status = await service.set(projectId, app.id, GOOGLE_INPUT, NOW_MS);

    expect(status).toEqual({
      connected: true,
      platform: 'ANDROID',
      liveVerified: false,
      verifiedAt: null,
    });
    const reloaded = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    expect(reloaded.storeCredentials).not.toBeNull(); // still connected
    expect(reloaded.storeCredentialsLiveVerified).toBe(false);
    expect(reloaded.storeCredentialsVerifiedAt).toBeNull();
  });

  it('set 422: structurally-invalid credential is rejected before any store write', async () => {
    const app = await seedAndroidApp();
    const malformed = { kind: 'google_play', serviceAccountJson: '{"type":"user"}' };

    await expect(service.set(projectId, app.id, malformed, NOW_MS)).rejects.toMatchObject({
      problem: { status: 422 },
    });

    expect(validator.validateCalls).toEqual([]);
    const reloaded = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    expect(reloaded.storeCredentials).toBeNull();
    expect(reloaded.storeCredentialsLiveVerified).toBe(false);
  });

  it('set 409: a blob whose kind mismatches the App platform is rejected (ANDROID app + app_store blob)', async () => {
    const app = await seedAndroidApp();

    await expect(service.set(projectId, app.id, APPLE_INPUT, NOW_MS)).rejects.toMatchObject({
      problem: { status: 409 },
    });

    expect(validator.validateCalls).toEqual([]);
    const reloaded = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    expect(reloaded.storeCredentials).toBeNull();
  });

  it('set 503: no STORE_CREDENTIALS_ENC_KEY configured — fails closed before validating or writing', async () => {
    const app = await seedAndroidApp();
    const keyless = new StoreCredentialsService(prisma as never, makeConfig(undefined), validator);

    await expect(keyless.set(projectId, app.id, GOOGLE_INPUT, NOW_MS)).rejects.toMatchObject({
      problem: { status: 503, title: 'Store credentials encryption key not configured' },
    });

    expect(validator.validateCalls).toEqual([]); // enc-key check precedes validation
    const reloaded = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    expect(reloaded.storeCredentials).toBeNull();
  });

  it('set 502: a generic validator error maps to 502 with the store message in detail, nothing written', async () => {
    const app = await seedAndroidApp();
    validator.failWith(new Error('App Store Connect rejected the key'));

    await expect(service.set(projectId, app.id, GOOGLE_INPUT, NOW_MS)).rejects.toMatchObject({
      problem: {
        status: 502,
        title: 'Store rejected the credentials',
        detail: 'App Store Connect rejected the key',
      },
    });

    const reloaded = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    expect(reloaded.storeCredentials).toBeNull();
    expect(reloaded.storeCredentialsLiveVerified).toBe(false);
  });

  it('set 404: a DIFFERENT projectId (cross-project) never finds the App — store not validated', async () => {
    const app = await seedAndroidApp();

    await expect(service.set(randomUUID(), app.id, GOOGLE_INPUT, NOW_MS)).rejects.toMatchObject({
      problem: { status: 404, title: 'App not found' },
    });

    expect(validator.validateCalls).toEqual([]);
  });

  it('set 404: an unknown appId (cross-app) in the right project 404s', async () => {
    await expect(service.set(projectId, randomUUID(), GOOGLE_INPUT, NOW_MS)).rejects.toMatchObject({
      problem: { status: 404, title: 'App not found' },
    });

    expect(validator.validateCalls).toEqual([]);
  });

  it('status: returns the connection status WITHOUT the secret, derived from the columns (no decrypt)', async () => {
    const app = await seedAndroidApp();
    validator.resolveWith(true);
    await service.set(projectId, app.id, GOOGLE_INPUT, NOW_MS);

    const status = await service.status(projectId, app.id);

    expect(status).toEqual({
      connected: true,
      platform: 'ANDROID',
      liveVerified: true,
      verifiedAt: new Date(NOW_MS),
    });
    expect(status).not.toHaveProperty('serviceAccountJson');
    expect(status).not.toHaveProperty('storeCredentials');
  });

  it('status: an un-connected App reads connected=false / liveVerified=false / verifiedAt=null', async () => {
    const app = await seedAndroidApp();

    const status = await service.status(projectId, app.id);

    expect(status).toEqual({
      connected: false,
      platform: 'ANDROID',
      liveVerified: false,
      verifiedAt: null,
    });
  });

  it('status 404: cross-project / unknown app', async () => {
    const app = await seedAndroidApp();

    await expect(service.status(randomUUID(), app.id)).rejects.toMatchObject({
      problem: { status: 404, title: 'App not found' },
    });
    await expect(service.status(projectId, randomUUID())).rejects.toMatchObject({
      problem: { status: 404, title: 'App not found' },
    });
  });

  it('disconnect: clears all three columns and is idempotent (safe to call again)', async () => {
    const app = await seedAndroidApp();
    validator.resolveWith(true);
    await service.set(projectId, app.id, GOOGLE_INPUT, NOW_MS);

    await service.disconnect(projectId, app.id);

    const afterFirst = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    expect(afterFirst.storeCredentials).toBeNull();
    expect(afterFirst.storeCredentialsLiveVerified).toBe(false);
    expect(afterFirst.storeCredentialsVerifiedAt).toBeNull();
    expect(await service.status(projectId, app.id)).toMatchObject({ connected: false });

    // Idempotent — a second disconnect (and a cross-project one) neither throws nor changes state.
    await expect(service.disconnect(projectId, app.id)).resolves.toBeUndefined();
    await expect(service.disconnect(randomUUID(), app.id)).resolves.toBeUndefined();
    const afterSecond = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    expect(afterSecond.storeCredentials).toBeNull();
  });

  it('decrypt round-trip: the stored blob decrypts back to the exact submitted credential', async () => {
    const app = await seedAndroidApp();
    validator.resolveWith(true);
    await service.set(projectId, app.id, GOOGLE_INPUT, NOW_MS);

    const reloaded = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    const decrypted = JSON.parse(decryptStoreCredentials(reloaded.storeCredentials as string, TEST_ENC_KEY));

    expect(decrypted).toEqual(GOOGLE_INPUT);
  });
});
