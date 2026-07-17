import { GoogleApiStoreClient, GoogleCredentialsUnavailableError } from './store-client.google-api';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Unit-level only: the real Play Developer API call this class will eventually make is not
 * exercised anywhere in this repo (no `googleapis` wiring, no live service-account credentials —
 * see the class docstring). This spec proves the ONE thing that IS implemented and load-bearing
 * today: any App with no (or an empty) `storeCredentials` throws `GoogleCredentialsUnavailableError`
 * — the signal `GoogleIngestService` converts into a replayable journal `FAILED`, never a crash.
 */
function fakePrisma(storeCredentials: string | null): PrismaService {
  return {
    app: {
      findFirst: jest.fn().mockResolvedValue(storeCredentials === null ? null : { storeCredentials }),
    },
  } as unknown as PrismaService;
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

  it('still throws (creds-gated, no googleapis wiring yet) even when storeCredentials IS set — flagged, not silently assumed working', async () => {
    const client = new GoogleApiStoreClient(fakePrisma('encrypted-blob'));

    await expect(client.getSubscriptionV2('com.myampix.app', 'token-1')).rejects.toBeInstanceOf(GoogleCredentialsUnavailableError);
  });
});
