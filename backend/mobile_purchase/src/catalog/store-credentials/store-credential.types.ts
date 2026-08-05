import { z } from 'zod';
import { AppPlatform } from '../../../generated/client';
import { ProblemException } from '../../common/problem-details';

/**
 * Store-credential blobs (design §1.2). The decrypted plaintext in `App.storeCredentials` is a JSON
 * blob discriminated by the App's platform: a Google Play service account (ANDROID) or an App Store
 * Connect API key + ASSN config (IOS). Structural validation (Zod) always runs before anything is
 * encrypted/stored; the live-verification seam (`store-credential-validator.ts`) is a separate step.
 */
export interface GooglePlayBlob {
  kind: 'google_play';
  /** Raw service-account JSON string (paste/upload of the `.json`). Structurally validated as JSON
   * with `type === 'service_account'` + `client_email` + `private_key` + `project_id`. */
  serviceAccountJson: string;
}

export interface AppStoreBlob {
  kind: 'app_store';
  /** App Store Connect API key issuer id — a UUID. */
  ascIssuerId: string;
  /** App Store Connect API key id — a 10-char identifier. */
  ascKeyId: string;
  /** The `.p8` private key PEM (contains `-----BEGIN PRIVATE KEY-----`). */
  ascPrivateKeyP8: string;
  /** The numeric App Store Connect app id (needed for Production ASSN verification). */
  appAppleId: string;
}

export type StoreCredentialBlob = GooglePlayBlob | AppStoreBlob;

/** JSON parse + shape check for the Google service account (design §1.2). */
function isServiceAccountJson(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return false;
  }
  const o = parsed as Record<string, unknown>;
  return (
    o.type === 'service_account' &&
    typeof o.client_email === 'string' && o.client_email.length > 0 &&
    typeof o.private_key === 'string' && o.private_key.length > 0 &&
    typeof o.project_id === 'string' && o.project_id.length > 0
  );
}

export const googlePlayBlobSchema = z.object({
  kind: z.literal('google_play'),
  serviceAccountJson: z
    .string()
    .min(1)
    .refine(isServiceAccountJson, {
      message:
        'must be valid service-account JSON (type "service_account" with client_email, private_key, project_id)',
    }),
});

export const appStoreBlobSchema = z.object({
  kind: z.literal('app_store'),
  ascIssuerId: z.string().uuid('must be a UUID'),
  ascKeyId: z.string().length(10, 'must be 10 characters'),
  ascPrivateKeyP8: z
    .string()
    .refine((s) => s.includes('-----BEGIN PRIVATE KEY-----'), {
      message: 'must be a PEM private key (contains "-----BEGIN PRIVATE KEY-----")',
    }),
  appAppleId: z.string().regex(/^\d+$/, 'must be all digits'),
});

/** ANDROID → google_play, IOS → app_store. Other platforms have no store-credential support. */
const EXPECTED_KIND: Partial<Record<AppPlatform, StoreCredentialBlob['kind']>> = {
  [AppPlatform.ANDROID]: 'google_play',
  [AppPlatform.IOS]: 'app_store',
};

const RECOGNIZED_KINDS = new Set<string>(['google_play', 'app_store']);

function extractKind(input: unknown): string | null {
  if (typeof input === 'object' && input !== null && 'kind' in input) {
    const kind = (input as Record<string, unknown>).kind;
    return typeof kind === 'string' ? kind : null;
  }
  return null;
}

function throwStructural422(error: z.ZodError): never {
  const issue = error.issues[0];
  const path = issue.path.join('.') || 'body';
  throw new ProblemException({
    status: 422,
    title: 'Unprocessable Entity',
    detail: `${path}: ${issue.message}`,
    errors: error.issues,
  });
}

/**
 * Structural (Zod) validation of a store-credential blob against the target App's platform
 * (design §1.2). Throws `ProblemException` 422 (with field errors) on a structural failure, and 409
 * when a well-formed blob's `kind` does not match the platform. Pure — no I/O, no live validation.
 */
export function parseStoreCredentialBlob(platform: AppPlatform, input: unknown): StoreCredentialBlob {
  const expectedKind = EXPECTED_KIND[platform];
  if (!expectedKind) {
    throw new ProblemException({
      status: 422,
      title: 'Unprocessable Entity',
      detail: `Store credentials are not supported for platform "${platform}" (only IOS and ANDROID)`,
    });
  }

  const inputKind = extractKind(input);
  if (inputKind !== null && inputKind !== expectedKind && RECOGNIZED_KINDS.has(inputKind)) {
    throw new ProblemException({
      status: 409,
      title: 'Conflict',
      detail: `Credential kind "${inputKind}" does not match app platform "${platform}" (expected "${expectedKind}")`,
    });
  }

  if (expectedKind === 'google_play') {
    const parsed = googlePlayBlobSchema.safeParse(input);
    if (!parsed.success) {
      throwStructural422(parsed.error);
    }
    return parsed.data;
  }

  const parsed = appStoreBlobSchema.safeParse(input);
  if (!parsed.success) {
    throwStructural422(parsed.error);
  }
  return parsed.data;
}
