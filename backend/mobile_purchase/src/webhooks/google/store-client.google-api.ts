import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppPlatform } from '../../../generated/client';
import type { GoogleOneTimeProductPurchase, GoogleSubscriptionV2, StoreClient } from './store-client';

/**
 * Thrown when `App.storeCredentials` is NULL/empty for the resolved `packageName` — the
 * `getSubscriptionV2`/`getProduct` caller (`GoogleIngestService`) treats this as a transport/
 * credentials failure (design §1.2/§8: "return `503`/journal `FAILED` (replayable) when creds are
 * absent at runtime"), exactly like any other thrown `StoreClient` error — never a crash, never a
 * silent `null` (which would be mistaken for a real 404 "no such purchase").
 */
export class GoogleCredentialsUnavailableError extends Error {
  constructor(packageName: string) {
    super(
      `Google Play service-account credentials are not available for packageName "${packageName}" ` +
        '(App.storeCredentials is NULL) — real Google ingest is blocked until a connect-store flow ' +
        'populates it (design §1.2/§8, mirrors M2a\'s deferred Apple Root G3 cert gate)',
    );
    this.name = 'GoogleCredentialsUnavailableError';
  }
}

/**
 * The real, `googleapis`-backed `StoreClient` (design §1.2/§8, M3 acceptance: "real needs the
 * service account"). NOT actually wired to `googleapis` (androidpublisher v3) yet — deliberately,
 * per the M3b brief's "your call, flag whichever you chose": `App.storeCredentials` is NULL for
 * every App today (P0 shipped the encrypted column, not the writer; there is no
 * `STORE_CREDENTIALS_ENC_KEY` decrypt helper either — P1 handoff), so a real API call could never
 * succeed in this codebase's current state regardless of whether the `googleapis` wiring exists.
 * Adding the `googleapis` dependency now would be dead weight (an untestable, uncallable code path)
 * for zero behavioral gain until the connect-store flow lands.
 *
 * What IS implemented: the credentials gate itself, behind the same `StoreClient` interface
 * `InMemoryStoreClient` implements — so swapping this class in for real ingest, once credentials
 * exist, is a DI provider change only (`google-store-client.factory.ts`), not a call-site change.
 * `requireCredentials` below is the seam a future patch replaces with an actual decrypt +
 * `googleapis` `androidpublisher('v3')` call; until then both methods always throw
 * `GoogleCredentialsUnavailableError`, converted by `GoogleIngestService` into a replayable journal
 * `FAILED` — never a 5xx, never an uncaught rejection. Untested beyond the credentials-gate itself
 * (no live Play Developer API call this repo can exercise) — flagged, not a gap silently assumed
 * away.
 */
@Injectable()
export class GoogleApiStoreClient implements StoreClient {
  constructor(private readonly prisma: PrismaService) {}

  async getSubscriptionV2(packageName: string, _purchaseToken: string): Promise<GoogleSubscriptionV2 | null> {
    await this.requireCredentials(packageName);
    // Unreachable today (requireCredentials always throws — storeCredentials is NULL for every
    // App) — the real `purchases.subscriptionsv2.get` call lands here once decryption exists.
    throw new GoogleCredentialsUnavailableError(packageName);
  }

  async getProduct(packageName: string, _productId: string, _purchaseToken: string): Promise<GoogleOneTimeProductPurchase | null> {
    await this.requireCredentials(packageName);
    // Unreachable today, same as getSubscriptionV2 — the real `purchases.products.get` call lands
    // here once decryption exists.
    throw new GoogleCredentialsUnavailableError(packageName);
  }

  async revokeAndRefundSubscription(packageName: string, _purchaseToken: string): Promise<void> {
    await this.requireCredentials(packageName);
    // Unreachable today, same as getSubscriptionV2 — the real `purchases.subscriptions.revoke`
    // call (refund last payment + immediate revoke, D1 refund design §1.3) lands here once
    // decryption exists.
    throw new GoogleCredentialsUnavailableError(packageName);
  }

  private async requireCredentials(packageName: string): Promise<string> {
    const app = await this.prisma.app.findFirst({
      where: { platform: AppPlatform.ANDROID, packageName },
      select: { storeCredentials: true },
    });
    if (!app?.storeCredentials) {
      throw new GoogleCredentialsUnavailableError(packageName);
    }
    // Still the encrypted-at-rest blob — no STORE_CREDENTIALS_ENC_KEY decrypt helper exists yet
    // (P1 handoff), so even a non-null value can't be turned into usable service-account JSON
    // today. Returned as-is for the future real implementation to decrypt.
    return app.storeCredentials;
  }
}
