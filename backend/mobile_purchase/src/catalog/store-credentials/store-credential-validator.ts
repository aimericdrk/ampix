import { Injectable } from '@nestjs/common';
import { AppPlatform } from '../../../generated/client';
import type { StoreCredentialBlob } from './store-credential.types';

/**
 * The App fields the validator targets a store app by (design §1.3). A narrow view of `App` so the
 * seam does not depend on Prisma — the loaded App row (E3) satisfies it structurally.
 */
export interface StoreCredentialValidatorApp {
  platform: AppPlatform;
  bundleId: string | null;
  packageName: string | null;
}

/**
 * Live-verification seam (design §1.3): given the target App + its structurally-valid credential
 * blob, confirm the credential actually works against the store (Play Developer API / App Store
 * Connect). Structural validation (`parseStoreCredentialBlob`) always runs FIRST and is independent
 * of this seam. Mirrors the `StoreClient` pattern: one interface, a creds-gated real impl, and an
 * in-memory double for tests.
 */
export interface StoreCredentialValidator {
  validate(app: StoreCredentialValidatorApp, blob: StoreCredentialBlob): Promise<{ liveVerified: boolean }>;
}

/**
 * Thrown by the real validator until the store SDKs (`googleapis` / an ASC JWT+HTTP path) and real
 * credentials are wired. The connect flow (E3) treats this as `liveVerified: false` / `pending`
 * (design §1.3) — exactly how `GoogleCredentialsUnavailableError` gates `GoogleApiStoreClient`
 * today. NOT a store rejection (that is a different, thrown error the service maps to 502).
 */
export class StoreValidationUnavailableError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Live store validation is not available — the store SDKs are not wired and no real store ' +
          'credentials exist yet (design §1.3, mirrors GoogleApiStoreClient\'s creds gate); the connect ' +
          'flow records liveVerified=false / pending',
    );
    this.name = 'StoreValidationUnavailableError';
  }
}

/**
 * The real, store-SDK-backed `StoreCredentialValidator` (design §1.3: `GoogleApiCredentialValidator`
 * / `AppStoreConnectCredentialValidator`, unified here behind one platform-dispatching drop-in). NOT
 * wired to `googleapis`/App Store Connect yet — deliberately, exactly like `GoogleApiStoreClient`:
 * there is no live store account or SDK path this repo can exercise, so a real call could never
 * succeed today. `validate` always throws `StoreValidationUnavailableError`, which the connect flow
 * converts into the `pending` posture. Swapping in the real Play/ASC calls, once creds + SDKs exist,
 * is a body change here + a factory change (`buildStoreCredentialValidator`) — never a call-site
 * change, since `StoreCredentialsService` (E3) depends on the interface only.
 */
@Injectable()
export class StoreApiCredentialValidator implements StoreCredentialValidator {
  async validate(app: StoreCredentialValidatorApp, _blob: StoreCredentialBlob): Promise<{ liveVerified: boolean }> {
    throw new StoreValidationUnavailableError(
      `Live store validation is not available for platform "${app.platform}"`,
    );
  }
}

/**
 * In-memory `StoreCredentialValidator` double (design §1.3/§4: drives every branch — verified /
 * rejected / unavailable). Default (unconfigured) resolves `{ liveVerified: true }`. Records every
 * `validate` call (even when it rejects) so specs can assert both "the validator WAS asked" and the
 * arguments it was asked with. Mirrors `InMemoryStoreClient`'s fluent-config + call-recording shape.
 */
export class InMemoryStoreCredentialValidator implements StoreCredentialValidator {
  /** Every `validate` call, in order — recorded even when the call rejects. */
  readonly validateCalls: Array<{ app: StoreCredentialValidatorApp; blob: StoreCredentialBlob }> = [];
  private result: { liveVerified: boolean } = { liveVerified: true };
  private error: Error | null = null;

  /** Resolve subsequent `validate` calls with `{ liveVerified }` (clears any configured error).
   * Fluent, like `InMemoryStoreClient.seed*`. */
  resolveWith(liveVerified: boolean): this {
    this.result = { liveVerified };
    this.error = null;
    return this;
  }

  /** Make subsequent `validate` calls reject with exactly `error` — a
   * `StoreValidationUnavailableError` to drive the `pending` branch, or a generic `Error` for the
   * 502 "store rejected" branch. Pass `null` to reset to the resolving default. */
  failWith(error: Error | null): this {
    this.error = error;
    return this;
  }

  async validate(app: StoreCredentialValidatorApp, blob: StoreCredentialBlob): Promise<{ liveVerified: boolean }> {
    this.validateCalls.push({ app, blob });
    if (this.error) {
      throw this.error;
    }
    return this.result;
  }
}

/** DI token for `StoreCredentialsService`'s validator dependency (mirrors `GOOGLE_STORE_CLIENT`). */
export const STORE_CREDENTIAL_VALIDATOR = 'STORE_CREDENTIAL_VALIDATOR';

/**
 * DI factory for `STORE_CREDENTIAL_VALIDATOR` (mirrors `buildGoogleStoreClient`). Always the real,
 * creds-gated `StoreApiCredentialValidator` in the running app; `InMemoryStoreCredentialValidator`
 * is a test-only double constructed directly by specs, never wired through this factory.
 */
export function buildStoreCredentialValidator(): StoreCredentialValidator {
  return new StoreApiCredentialValidator();
}
