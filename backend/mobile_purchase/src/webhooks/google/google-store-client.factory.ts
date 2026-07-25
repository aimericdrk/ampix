import { PrismaService } from '../../prisma/prisma.service';
import { GoogleApiStoreClient } from './store-client.google-api';
import type { StoreClient } from './store-client';

export const GOOGLE_STORE_CLIENT = 'GOOGLE_STORE_CLIENT';

/**
 * DI wiring for `GoogleIngestService`'s `StoreClient` dependency (mirrors
 * `google-push-auth.factory.ts`'s role of turning config/deps into the concrete implementation the
 * consumer depends on by interface). Always the real, decrypt-wired `GoogleApiStoreClient` in the
 * running app — `InMemoryStoreClient` is a test-only double, constructed directly by specs, never
 * wired through this factory (design §1.2/§8: "mocked in tests, real needs the service account").
 * `encKey` is `AppConfig.storeCredentialsEncKey` (`STORE_CREDENTIALS_ENC_KEY`), passed so
 * `requireCredentials` can decrypt a stored credential (design §1.6); `undefined` when unset →
 * credentials stay unavailable (fail-closed).
 */
export function buildGoogleStoreClient(prisma: PrismaService, encKey?: string): StoreClient {
  return new GoogleApiStoreClient(prisma, encKey);
}
