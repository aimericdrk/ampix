import { Inject, Injectable } from '@nestjs/common';
import { AppPlatform } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { encryptStoreCredentials } from '../../common/crypto/store-credentials-cipher';
import { parseStoreCredentialBlob } from './store-credential.types';
import {
  STORE_CREDENTIAL_VALIDATOR,
  StoreValidationUnavailableError,
  type StoreCredentialValidator,
} from './store-credential-validator';

/** Non-secret connection status returned by every store-credential operation. The plaintext
 * credential is NEVER part of this shape (design §1.4/§1.5). */
export interface StoreCredentialStatus {
  connected: boolean;
  platform: AppPlatform;
  liveVerified: boolean;
  verifiedAt: Date | null;
}

/**
 * Connect-stores service (design §1.4): set / status / disconnect for an App's encrypted store
 * credential. `set` is the only writer — it structurally validates (422/409), fails closed without
 * an encryption key (503), runs the creds-gated live validator (pending on
 * `StoreValidationUnavailableError`, 502 on any other store error), then encrypts and persists the
 * blob plus the two non-secret status columns. Reads NEVER decrypt (status is derived from the
 * columns) and NEVER return the secret. All ops are double-scoped by `projectId` — a wrong scope is
 * an opaque 404, never a leak of which scope failed.
 */
@Injectable()
export class StoreCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(STORE_CREDENTIAL_VALIDATOR) private readonly validator: StoreCredentialValidator,
  ) {}

  async set(
    projectId: string,
    appId: string,
    input: unknown,
    nowMs: number = Date.now(),
  ): Promise<StoreCredentialStatus> {
    // Double-scoped load — cross-project and unknown-app both 404 with the same opaque title.
    const app = await this.prisma.app.findFirst({
      where: { id: appId, projectId },
      select: { id: true, projectId: true, platform: true, bundleId: true, packageName: true },
    });
    if (!app) throw new ProblemException({ status: 404, title: 'App not found' });

    // Structural validation (422) + platform/kind mismatch (409) — always before any store call.
    const blob = parseStoreCredentialBlob(app.platform, input);

    // Fail closed: without the encryption key we cannot store the secret at rest (design §1.4).
    const keyB64 = this.config.storeCredentialsEncKey;
    if (!keyB64) {
      throw new ProblemException({ status: 503, title: 'Store credentials encryption key not configured' });
    }

    // Creds-gated live validation: unavailable -> stored but `pending`; any other error -> 502.
    // The validator's `StoreCredentialValidatorApp` seam is narrow by design (platform + store
    // identifiers only) — it does not carry id/projectId, so pass exactly that shape.
    let liveVerified: boolean;
    try {
      const result = await this.validator.validate(
        { platform: app.platform, bundleId: app.bundleId, packageName: app.packageName },
        blob,
      );
      liveVerified = result.liveVerified;
    } catch (e) {
      if (e instanceof StoreValidationUnavailableError) {
        liveVerified = false;
      } else {
        // TODO(real Play/ASC validator): the store's error message becomes `detail` verbatim here.
        // The future live validator MUST ensure its error strings never echo submitted key
        // material (private keys, shared secrets) back into this message — sanitize/allowlist
        // before throwing, don't rely on this call site to redact it.
        throw new ProblemException({
          status: 502,
          title: 'Store rejected the credentials',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const cipher = encryptStoreCredentials(JSON.stringify(blob), keyB64);
    const verifiedAt = liveVerified ? new Date(nowMs) : null;
    await this.prisma.app.update({
      where: { id: app.id },
      data: {
        storeCredentials: cipher,
        storeCredentialsLiveVerified: liveVerified,
        storeCredentialsVerifiedAt: verifiedAt,
      },
    });

    return { connected: true, platform: app.platform, liveVerified, verifiedAt };
  }

  async status(projectId: string, appId: string): Promise<StoreCredentialStatus> {
    const app = await this.prisma.app.findFirst({
      where: { id: appId, projectId },
      select: {
        platform: true,
        storeCredentials: true,
        storeCredentialsLiveVerified: true,
        storeCredentialsVerifiedAt: true,
      },
    });
    if (!app) throw new ProblemException({ status: 404, title: 'App not found' });
    // `storeCredentials` is loaded only to derive the boolean — the value is never returned.
    return {
      connected: app.storeCredentials !== null,
      platform: app.platform,
      liveVerified: app.storeCredentialsLiveVerified,
      verifiedAt: app.storeCredentialsVerifiedAt,
    };
  }

  async disconnect(projectId: string, appId: string): Promise<void> {
    // Idempotent + scoped: a matching App is cleared; a cross-project/unknown id no-ops (count 0).
    await this.prisma.app.updateMany({
      where: { id: appId, projectId },
      data: {
        storeCredentials: null,
        storeCredentialsLiveVerified: false,
        storeCredentialsVerifiedAt: null,
      },
    });
  }
}
