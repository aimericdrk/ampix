import { GoogleApiStoreClient, GoogleCredentialsUnavailableError } from './store-client.google-api';
import type { GoogleServiceAccount } from './store-client.google-api';
import { encryptStoreCredentials } from '../../common/crypto/store-credentials-cipher';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Unit-level only: the real Play Developer API call this class will eventually make is not
 * exercised anywhere in this repo (no `googleapis` wiring, no live service-account credentials —
 * see the class docstring). This spec proves the two things that ARE implemented and load-bearing
 * today: (1) any App with no `storeCredentials`, or a missing enc key, or an undecryptable blob,
 * throws `GoogleCredentialsUnavailableError` — the signal `GoogleIngestService` converts into a
 * replayable journal `FAILED`; (2) E5's decrypt seam: a stored, encrypted service-account blob +
 * the enc key is decrypted + JSON.parsed back to the Google service account by
 * `requireCredentials` — while the googleapis NETWORK call in the public methods STAYS gated.
 */
function fakePrisma(storeCredentials: string | null): PrismaService {
  return {
    app: {
      findFirst: jest.fn().mockResolvedValue(storeCredentials === null ? null : { storeCredentials }),
    },
  } as unknown as PrismaService;
}

// A deterministic, valid 32-byte AES-256 key (base64) — decodes to exactly 32 bytes so the cipher
// accepts it. Never a real key; unit-fixture only.
const KEY_B64 = Buffer.alloc(32, 7).toString('base64');

// A structurally-plausible Google service account (never a real credential).
const SERVICE_ACCOUNT: GoogleServiceAccount = {
  type: 'service_account',
  project_id: 'myampix-play-fixture',
  client_email: 'sa@myampix-play-fixture.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nZmFrZS1rZXktbm90LXJlYWw=\n-----END PRIVATE KEY-----\n',
};

// The private method is exercised directly — the public methods deliberately still throw at the
// network gate, so they cannot prove the decrypt seam returns the SA.
function callRequireCredentials(client: GoogleApiStoreClient, packageName: string): Promise<GoogleServiceAccount> {
  return (client as unknown as { requireCredentials(pn: string): Promise<GoogleServiceAccount> }).requireCredentials(packageName);
}

describe('GoogleApiStoreClient', () => {
  it('getSubscriptionV2 throws GoogleCredentialsUnavailableError when the App has no storeCredentials', async () => {
    const client = new GoogleApiStoreClient(fakePrisma(null));

    await expect(client.getSubscriptionV2('com.myampix.app', 'token-1')).rejects.toBeInstanceOf(GoogleCredentialsUnavailableError);
  });

  it('getProduct throws GoogleCredentialsUnavailableError when the App has no storeCredentials', async () => {
    const client = new GoogleApiStoreClient(fakePrisma(null));

    await expect(client.getProduct('com.myampix.app', 'sku-1', 'token-1')).rejects.toBeInstanceOf(GoogleCredentialsUnavailableError);
  });

  it('revokeAndRefundSubscription throws GoogleCredentialsUnavailableError when the App has no storeCredentials', async () => {
    const client = new GoogleApiStoreClient(fakePrisma(null));

    await expect(client.revokeAndRefundSubscription('com.myampix.app', 'token-1')).rejects.toBeInstanceOf(GoogleCredentialsUnavailableError);
  });

  it('requireCredentials throws GoogleCredentialsUnavailableError when a cred is stored but no enc key is configured', async () => {
    const blob = encryptStoreCredentials(JSON.stringify(SERVICE_ACCOUNT), KEY_B64);
    const client = new GoogleApiStoreClient(fakePrisma(blob)); // no key passed

    await expect(callRequireCredentials(client, 'com.myampix.app')).rejects.toBeInstanceOf(GoogleCredentialsUnavailableError);
  });

  it('requireCredentials throws GoogleCredentialsUnavailableError when the stored blob cannot be decrypted with the configured key', async () => {
    const client = new GoogleApiStoreClient(fakePrisma('not-a-valid-cipher-blob'), KEY_B64);

    await expect(callRequireCredentials(client, 'com.myampix.app')).rejects.toBeInstanceOf(GoogleCredentialsUnavailableError);
  });

  it('requireCredentials decrypts + JSON.parses a stored cred and returns the Google service account when the enc key is configured', async () => {
    const blob = encryptStoreCredentials(JSON.stringify(SERVICE_ACCOUNT), KEY_B64);
    const client = new GoogleApiStoreClient(fakePrisma(blob), KEY_B64);

    await expect(callRequireCredentials(client, 'com.myampix.app')).resolves.toEqual(SERVICE_ACCOUNT);
  });

  it('getSubscriptionV2 STILL throws (googleapis network stays gated) even with a valid cred + enc key — flagged, not silently assumed working', async () => {
    const blob = encryptStoreCredentials(JSON.stringify(SERVICE_ACCOUNT), KEY_B64);
    const client = new GoogleApiStoreClient(fakePrisma(blob), KEY_B64);

    await expect(client.getSubscriptionV2('com.myampix.app', 'token-1')).rejects.toBeInstanceOf(GoogleCredentialsUnavailableError);
  });

  it('revokeAndRefundSubscription STILL throws (googleapis network stays gated) even with a valid cred + enc key — flagged, not silently assumed working', async () => {
    const blob = encryptStoreCredentials(JSON.stringify(SERVICE_ACCOUNT), KEY_B64);
    const client = new GoogleApiStoreClient(fakePrisma(blob), KEY_B64);

    await expect(client.revokeAndRefundSubscription('com.myampix.app', 'token-1')).rejects.toBeInstanceOf(GoogleCredentialsUnavailableError);
  });
});
