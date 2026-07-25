import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppPlatform } from '../../../generated/client';
import { decryptStoreCredentials } from '../../common/crypto/store-credentials-cipher';
import type { GoogleOneTimeProductPurchase, GoogleSubscriptionV2, StoreClient } from './store-client';

/**
 * Thrown when usable Google Play service-account credentials cannot be produced for the resolved
 * `packageName` — because `App.storeCredentials` is NULL/empty, OR `STORE_CREDENTIALS_ENC_KEY` is
 * unset so the stored blob can't be decrypted, OR the stored blob fails to decrypt/parse. The
 * `getSubscriptionV2`/`getProduct`/`revokeAndRefundSubscription` caller (`GoogleIngestService`)
 * treats this as a transport/credentials failure (design §1.2/§8: "return `503`/journal `FAILED`
 * (replayable) when creds are absent at runtime"), exactly like any other thrown `StoreClient`
 * error — never a crash, never a silent `null` (which would be mistaken for a real 404 "no such
 * purchase").
 */
export class GoogleCredentialsUnavailableError extends Error {
  constructor(packageName: string) {
    super(
      `Google Play service-account credentials are not available for packageName "${packageName}" ` +
        '(App.storeCredentials is NULL, or STORE_CREDENTIALS_ENC_KEY is unset, or the stored blob ' +
        'could not be decrypted) — real Google ingest stays blocked until a connect-store flow ' +
        'populates a decryptable credential (design §1.2/§1.6/§8)',
    );
    this.name = 'GoogleCredentialsUnavailableError';
  }
}

/**
 * The decrypted Google Play service-account JSON, as returned by `requireCredentials`. Only the
 * fields the eventual `googleapis` auth needs are named; the rest of the service-account JSON is
 * preserved via the index signature (the whole object is handed to Google's auth client).
 */
export interface GoogleServiceAccount {
  type: string;
  project_id: string;
  client_email: string;
  private_key: string;
  [key: string]: unknown;
}

/**
 * The real, `googleapis`-backed `StoreClient` (design §1.2/§8, M3 acceptance: "real needs the
 * service account"). E5 wires the DECRYPT path: `requireCredentials` now decrypts a stored
 * `App.storeCredentials` blob (AES-256-GCM, via `STORE_CREDENTIALS_ENC_KEY`) and `JSON.parse`s it
 * back to the Google service account — so a stored credential is REACHABLE. The `googleapis`
 * androidpublisher v3 NETWORK call is still NOT wired: `getSubscriptionV2`/`getProduct`/
 * `revokeAndRefundSubscription` deliberately still throw `GoogleCredentialsUnavailableError` after
 * requiring credentials, so E5 does not accidentally "turn on" live store calls (design §1.6). The
 * actual `purchases.subscriptionsv2.get` / `purchases.products.get` / `purchases.subscriptions.revoke`
 * calls land at the marked seams once the `googleapis` client is wired (procurement-gated, X1). Both
 * this class and the test-only `InMemoryStoreClient` implement the same `StoreClient` interface, so
 * swapping implementations is a DI provider change only (`google-store-client.factory.ts`).
 */
@Injectable()
export class GoogleApiStoreClient implements StoreClient {
  constructor(
    private readonly prisma: PrismaService,
    // AES-256-GCM key (base64) from `AppConfig.storeCredentialsEncKey`; injected via
    // `google-store-client.factory.ts`. Optional: when unset every credential is undecryptable, so
    // `requireCredentials` throws `GoogleCredentialsUnavailableError` (fail-closed, same posture as
    // a NULL blob).
    private readonly encKey?: string,
  ) {}

  async getSubscriptionV2(packageName: string, _purchaseToken: string): Promise<GoogleSubscriptionV2 | null> {
    await this.requireCredentials(packageName);
    // Network seam: the real `purchases.subscriptionsv2.get` call lands here once the `googleapis`
    // client is wired. Still gated (throws) so E5's decrypt path does not enable live store calls.
    throw new GoogleCredentialsUnavailableError(packageName);
  }

  async getProduct(packageName: string, _productId: string, _purchaseToken: string): Promise<GoogleOneTimeProductPurchase | null> {
    await this.requireCredentials(packageName);
    // Network seam: the real `purchases.products.get` call lands here once the `googleapis` client
    // is wired. Still gated (throws) — same reason as getSubscriptionV2.
    throw new GoogleCredentialsUnavailableError(packageName);
  }

  async revokeAndRefundSubscription(packageName: string, _purchaseToken: string): Promise<void> {
    await this.requireCredentials(packageName);
    // Network seam: the real `purchases.subscriptions.revoke` call (refund last payment + immediate
    // revoke, D1 refund design §1.3) lands here once the `googleapis` client is wired. Still gated
    // (throws) — same reason as getSubscriptionV2.
    throw new GoogleCredentialsUnavailableError(packageName);
  }

  /**
   * Resolves the App by `packageName`, decrypts its stored `storeCredentials` blob with the
   * configured enc key, and returns the parsed Google service account. Throws
   * `GoogleCredentialsUnavailableError` when the App has no stored credential, when no enc key is
   * configured, or when the blob fails to decrypt/parse — the single signal `GoogleIngestService`
   * turns into a replayable journal `FAILED`.
   */
  private async requireCredentials(packageName: string): Promise<GoogleServiceAccount> {
    const app = await this.prisma.app.findFirst({
      where: { platform: AppPlatform.ANDROID, packageName },
      select: { storeCredentials: true },
    });
    if (!app?.storeCredentials) {
      throw new GoogleCredentialsUnavailableError(packageName);
    }
    if (!this.encKey) {
      // Column populated but no key to decrypt it — fail closed, exactly like a NULL blob.
      throw new GoogleCredentialsUnavailableError(packageName);
    }
    try {
      const plaintext = decryptStoreCredentials(app.storeCredentials, this.encKey);
      return JSON.parse(plaintext) as GoogleServiceAccount;
    } catch {
      // StoreCipherError (bad key length / tamper / auth-tag failure) or a JSON.parse failure —
      // an undecryptable/corrupt credential is unusable; surface it as the same gated error.
      throw new GoogleCredentialsUnavailableError(packageName);
    }
  }
}
