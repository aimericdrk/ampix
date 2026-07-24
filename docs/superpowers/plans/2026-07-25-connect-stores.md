# Connect Stores (store-credential management, E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MyRevenueCat's "Integration settings" (a connect-to-**real-RevenueCat** API-key form) with a **connect-your-stores** flow — per app, provide the store credentials the self-hosted clone uses to talk to the stores directly (Google Play service account; Apple App Store Connect API key + ASSN config), stored encrypted, with connection status and disconnect.

**Architecture:** Backend (`mobile_purchase`): an AES-256-GCM cipher for `STORE_CREDENTIALS_ENC_KEY` → typed+Zod-validated credential blobs → a creds-gated live-validator seam (structural validation always runs; live check is a drop-in) → admin-gated set/status/disconnect endpoints on the existing `App` → decrypt wired into `GoogleApiStoreClient.requireCredentials` so stored creds reach the already-built paths (D1 refund). Dashboard: `RcSettingsPage` becomes a per-app connection list with platform-specific Connect/Manage/Disconnect dialogs. The legacy RevenueCat connect flow stays in project settings/analytics; it only leaves `RcSettingsPage`.

**Tech Stack:** NestJS 11 + Prisma 6 + jest/Testcontainers (`mobile_purchase`); React + TanStack Query + Vitest/MSW (`dashboard`). `node:crypto` AES-256-GCM. No new store SDKs (the live network call stays a creds-gated drop-in).

**Design spec:** `docs/superpowers/specs/2026-07-25-connect-stores-design.md` (all § references point there).

## Global Constraints

Every task's requirements implicitly include all of these:

- **Creds-free build.** Storing, structurally validating, and encrypting credentials needs no real store account. The **live** validation call and the eventual live store network calls are **creds-gated drop-ins** built as seams (tested against fakes) that stay throwing (`StoreValidationUnavailableError` / `GoogleCredentialsUnavailableError`) until the store SDKs + real creds land. Do NOT add `googleapis` / an ASC HTTP client or un-gate any network call.
- **Store-and-structural-validate posture.** On connect: structural validation always runs (422 on failure); live validation runs when available, else the app is `connected` with `liveVerified=false` (pending). No credential that fails **structural** validation is ever stored.
- **Secrets never leave the server.** No read endpoint or response returns the plaintext or ciphertext credential — status only. Encrypt with AES-256-GCM keyed by `STORE_CREDENTIALS_ENC_KEY`; if it's unset, the set endpoint returns **503**.
- **Reuse existing seams.** Credentials hang off existing `App` rows; admin-gated writes (`@RequireProjectRole('admin')`), viewer status reads, double-scoped by `projectId`, `ProblemException` errors, `parseOrThrow`. The validator seam mirrors the `StoreClient`/`GOOGLE_STORE_CLIENT` interface+gated-real-impl+InMemory-double+DI-token+factory pattern exactly.
- **Keep RevenueCat legacy.** Do NOT delete `IntegrationsSection.tsx` or the `mobile_analytics` `RevenueCatIntegration` flow — they stay in project settings / analytics. E7 only stops rendering `IntegrationsSection` on `RcSettingsPage`.
- **HARD WIP rule:** NEVER touch or stage the user's uncommitted collapse-rail WIP — `dashboard/src/components/layout/*`, `CommandPalette.tsx`, `render-app.tsx`, `RailInitial.tsx`, `demo_config.dart`, the two `2026-07-16-dashboard-tool-rail*` docs. **`nav-model.ts` + `nav-model.test.ts` also carry this session's committed-logic nav de-gate edit awaiting the user's commit — leave those hunks untouched too.** Always `git add` the specific task files — **never `git add -A`**.
- **Commits:** per-task commits authorized; the USER pushes/merges. Convention `feat(mobile_purchase): …` / `feat(dashboard): …` / `test(…): …`. **No co-author trailer, ever.** Never commit `.env` / secrets / `.p8` / service-account JSON.
- **Environment:** `mobile_purchase` has NO `.env`; Testcontainers specs manage their own DB (**Docker required**). Single-file jest = `npx jest <path>`. Dashboard: run ONE vitest file at a time (`npx vitest run <file>`); native elements only in new UI (Radix `Select` hangs jsdom); on a hang `pkill -9 -f vitest`.

## Reconciled cross-task contract (authoritative — overrides any section text that drifts)

The parallel section-authors pinned a few names slightly differently; these are the canonical forms every task uses:

- **`InMemoryStoreCredentialValidator`** (E2): fluent `resolveWith(liveVerified: boolean): this` (unconfigured default resolves `{ liveVerified: true }`), `failWith(error: Error | null): this` (non-null → `validate` rejects with it; `null` resets to resolve), and `readonly validateCalls: Array<{ app: StoreCredentialValidatorApp; blob: StoreCredentialBlob }>`. E3's spec uses `resolveWith(true)` / `failWith(new StoreValidationUnavailableError(...))`.
- **`StoreValidationUnavailableError`** (E2): `constructor(message?: string)` (message-arg, like the string E3 passes). Not a platform arg.
- **`StoreCredentialValidatorApp`** (E2): `{ platform: AppPlatform; bundleId: string | null; packageName: string | null }`. E3 may pass an object that ALSO carries `id`/`projectId` (structural-extra fields are fine).
- **`buildStoreCredentialValidator(): StoreCredentialValidator`** (E2): no-arg factory (mirrors `buildGoogleStoreClient`). E4 wires it as `{ provide: STORE_CREDENTIAL_VALIDATOR, useFactory: buildStoreCredentialValidator }` with no `inject`.
- **Apps-list status fields (E4):** the existing `GET …/catalog/apps` response gains **both** derived booleans per app — `storeConnected: boolean` (= `storeCredentials !== null`) **and** `storeCredentialsLiveVerified: boolean` (= the `storeCredentialsLiveVerified` column) — selected WITHOUT loading the blob (never the omit'd ciphertext). So the per-app LIST renders its 3-state (`Not connected` / `Connected` / `Connected · live-verify pending`) from the single apps query; E6's `useStoreCredentialStatus` GET remains for a detailed per-app read (returns the full `StoreCredentialStatus` incl. `verifiedAt`). E6/E7's `RcApp` type carries both `storeConnected?: boolean` and `storeCredentialsLiveVerified?: boolean` (optional/additive so existing `catalog-api.test.ts` fixtures compile).
- **Migration** (E3): generate with `npx prisma migrate dev --name store_credentials_status` against a throwaway Postgres; the additive `ALTER TABLE apps ADD COLUMN` migration is committed. E5's decrypt work must land AFTER E1 (it imports the cipher).

---
### Task 1 (E1): Store-credentials AES-256-GCM cipher + `STORE_CREDENTIALS_ENC_KEY` config hardening

**Files:**
- Create: `backend/mobile_purchase/src/common/crypto/store-credentials-cipher.ts`
- Create (test): `backend/mobile_purchase/src/common/crypto/store-credentials-cipher.spec.ts`
- Modify: `backend/mobile_purchase/src/config/app-config.ts` (add a `.refine` to the existing `STORE_CREDENTIALS_ENC_KEY` field, line 26; `AppConfig.storeCredentialsEncKey` stays optional string; `loadConfig` mapping at line 113 already passes it through unchanged)
- Modify (test): `backend/mobile_purchase/src/config/app-config.spec.ts` (append a `STORE_CREDENTIALS_ENC_KEY` describe block)

**Interfaces:**
- Consumes (existing code, verified):
  - `node:crypto` — `createCipheriv`, `createDecipheriv`, `randomBytes` (Node 22; already used as `randomBytes` in `src/catalog/support/key-generator.ts`).
  - `src/config/app-config.ts`: `envSchema` Zod object, `STORE_CREDENTIALS_ENC_KEY: z.string().optional()` at line 26, the `.refine((value) => {...}, 'message')` pattern used by `ANALYTICS_INTERNAL_URL` (lines 13-23), `loadConfig()` which aggregates `parsed.error.issues` into `` `${issue.path.join('.')}: ${issue.message}` `` (lines 97-103) and maps `storeCredentialsEncKey: v.STORE_CREDENTIALS_ENC_KEY` (line 113). `AppConfig.storeCredentialsEncKey?: string` (line 68).
  - `jest.config.js`: `preset: ts-jest`, `testEnvironment: node`, `testMatch: ['<rootDir>/src/**/*.spec.ts', ...]`. Single-file run: `npx jest <path>` from `backend/mobile_purchase`.
- Produces (E2/E3/E5 rely on these EXACT signatures):
  - `encryptStoreCredentials(plaintext: string, keyB64: string): string` — AES-256-GCM, random 12-byte IV, output `base64(iv).base64(tag).base64(ciphertext)` (dot-joined single string for the `storeCredentials` column).
  - `decryptStoreCredentials(blob: string, keyB64: string): string`.
  - `class StoreCipherError extends Error` — thrown on wrong key length, tamper/auth-tag failure, or malformed blob.
  - Config: `STORE_CREDENTIALS_ENC_KEY` stays optional at boot but, when present, is rejected unless it base64-decodes to exactly 32 bytes.

> All commands below run from `backend/mobile_purchase/`. Pure unit tests — no Docker/Testcontainers.

---

#### Cycle 1 — cipher module (round-trip, wrong-key-length, tamper, malformed)

- [ ] **Step 1: Write the failing cipher spec.** Create `backend/mobile_purchase/src/common/crypto/store-credentials-cipher.spec.ts`:

```ts
import { randomBytes } from 'node:crypto';

import {
  StoreCipherError,
  decryptStoreCredentials,
  encryptStoreCredentials,
} from './store-credentials-cipher';

const KEY_B64 = randomBytes(32).toString('base64');

describe('store-credentials-cipher', () => {
  it('round-trips plaintext through encrypt → decrypt and never leaks it', () => {
    const plaintext = JSON.stringify({
      kind: 'google_play',
      serviceAccountJson: '{"type":"service_account","client_email":"x@y.iam"}',
    });

    const blob = encryptStoreCredentials(plaintext, KEY_B64);

    expect(blob).not.toContain(plaintext);
    expect(blob.split('.')).toHaveLength(3);
    expect(decryptStoreCredentials(blob, KEY_B64)).toBe(plaintext);
  });

  it('uses a fresh IV per call so identical plaintext yields distinct blobs', () => {
    const first = encryptStoreCredentials('secret', KEY_B64);
    const second = encryptStoreCredentials('secret', KEY_B64);

    expect(first).not.toBe(second);
    expect(decryptStoreCredentials(first, KEY_B64)).toBe('secret');
    expect(decryptStoreCredentials(second, KEY_B64)).toBe('secret');
  });

  it('throws StoreCipherError when the key does not decode to 32 bytes (encrypt)', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => encryptStoreCredentials('secret', shortKey)).toThrow(StoreCipherError);
  });

  it('throws StoreCipherError when the key does not decode to 32 bytes (decrypt)', () => {
    const blob = encryptStoreCredentials('secret', KEY_B64);
    const shortKey = randomBytes(16).toString('base64');
    expect(() => decryptStoreCredentials(blob, shortKey)).toThrow(StoreCipherError);
  });

  it('throws StoreCipherError when decrypting with a different valid 32-byte key', () => {
    const blob = encryptStoreCredentials('secret', KEY_B64);
    const otherKey = randomBytes(32).toString('base64');
    expect(() => decryptStoreCredentials(blob, otherKey)).toThrow(StoreCipherError);
  });

  it('throws StoreCipherError when the ciphertext is tampered', () => {
    const blob = encryptStoreCredentials('secret', KEY_B64);
    const [iv, tag, ciphertext] = blob.split('.');
    const bytes = Buffer.from(ciphertext, 'base64');
    bytes[0] ^= 0xff;
    const tampered = [iv, tag, bytes.toString('base64')].join('.');

    expect(() => decryptStoreCredentials(tampered, KEY_B64)).toThrow(StoreCipherError);
  });

  it('throws StoreCipherError on a malformed blob (wrong segment count)', () => {
    expect(() => decryptStoreCredentials('not-a-valid-blob', KEY_B64)).toThrow(StoreCipherError);
  });

  it('throws StoreCipherError on a blob whose IV segment is the wrong length', () => {
    const blob = encryptStoreCredentials('secret', KEY_B64);
    const [, tag, ciphertext] = blob.split('.');
    const badIv = [randomBytes(8).toString('base64'), tag, ciphertext].join('.');

    expect(() => decryptStoreCredentials(badIv, KEY_B64)).toThrow(StoreCipherError);
  });
});
```

- [ ] **Step 2: Run it — expect a compile/resolve failure.**
  - Command: `npx jest src/common/crypto/store-credentials-cipher.spec.ts`
  - Expected: fails — `Cannot find module './store-credentials-cipher'` (the impl file does not exist yet).

- [ ] **Step 3: Write the cipher implementation.** Create `backend/mobile_purchase/src/common/crypto/store-credentials-cipher.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM cipher for the encrypted-at-rest `App.storeCredentials` blob.
 *
 * A stored credential is a single self-describing string: `base64(iv).base64(tag).base64(ciphertext)`
 * (dot-joined), so one column round-trips without a separate IV/tag column. The 12-byte IV is random
 * per encryption; the 16-byte GCM auth tag makes any tamper fail closed.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SEGMENTS = 3;

/**
 * Thrown when the encryption key is the wrong length, or a blob fails to decrypt — a GCM auth-tag
 * mismatch (tamper / wrong key) or a structurally malformed blob. Callers (E3 service, E5 store
 * client) map this to a fail-closed store-credential path, never to a leaked plaintext.
 */
export class StoreCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreCipherError';
  }
}

/** Decode the base64 key and enforce the exact AES-256 length. */
function decodeKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new StoreCipherError(
      `Store credentials key must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

/** Encrypt `plaintext` → `base64(iv).base64(tag).base64(ciphertext)`. */
export function encryptStoreCredentials(plaintext: string, keyB64: string): string {
  const key = decodeKey(keyB64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

/** Decrypt a `base64(iv).base64(tag).base64(ciphertext)` blob. Any failure is a StoreCipherError. */
export function decryptStoreCredentials(blob: string, keyB64: string): string {
  const key = decodeKey(keyB64);

  const parts = blob.split('.');
  if (parts.length !== SEGMENTS) {
    throw new StoreCipherError('Malformed store credentials blob: expected iv.tag.ciphertext');
  }

  const [ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  if (iv.length !== IV_BYTES) {
    throw new StoreCipherError('Malformed store credentials blob: bad IV length');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new StoreCipherError('Failed to decrypt store credentials (tampered or wrong key)');
  }
}
```

- [ ] **Step 4: Run the cipher spec — expect green.**
  - Command: `npx jest src/common/crypto/store-credentials-cipher.spec.ts`
  - Expected: all 8 tests pass. (`setAuthTag` with a wrong-length tag and `decipher.final()` on tampered/wrong-key input both throw inside the `try`, surfacing as `StoreCipherError`.)

- [ ] **Step 5: Typecheck.**
  - Command: `npm run typecheck`
  - Expected: exits 0 (no new type errors).

- [ ] **Step 6: Commit the cipher module + its spec.**
  - `git add backend/mobile_purchase/src/common/crypto/store-credentials-cipher.ts backend/mobile_purchase/src/common/crypto/store-credentials-cipher.spec.ts`
  - `git commit -m "feat(mobile_purchase): AES-256-GCM store-credentials cipher + StoreCipherError"`
  - (No `git add -A`; no co-author trailer.)

---

#### Cycle 2 — `STORE_CREDENTIALS_ENC_KEY` config refine (32-byte base64 or reject)

- [ ] **Step 7: Append the failing config spec.** In `backend/mobile_purchase/src/config/app-config.spec.ts`, first change the top import line (line 1) to also pull in `randomBytes`:

```ts
import { randomBytes } from 'node:crypto';

import { describeConfig, loadConfig } from './app-config';
```

Then append this describe block at the end of the file (after the closing `});` of the existing `describe`):

```ts
describe('loadConfig — STORE_CREDENTIALS_ENC_KEY (encrypted-at-rest key)', () => {
  it('leaves storeCredentialsEncKey undefined when the var is unset', () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.storeCredentialsEncKey).toBeUndefined();
  });

  it('accepts a base64 value that decodes to exactly 32 bytes', () => {
    const key = randomBytes(32).toString('base64');
    const config = loadConfig({ ...BASE_ENV, STORE_CREDENTIALS_ENC_KEY: key });
    expect(config.storeCredentialsEncKey).toBe(key);
  });

  it('rejects a base64 value that decodes to fewer than 32 bytes', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => loadConfig({ ...BASE_ENV, STORE_CREDENTIALS_ENC_KEY: shortKey })).toThrow(
      /STORE_CREDENTIALS_ENC_KEY/,
    );
  });
});
```

- [ ] **Step 8: Run it — expect the third test to fail.**
  - Command: `npx jest src/config/app-config.spec.ts`
  - Expected: the first two pass; `rejects a base64 value that decodes to fewer than 32 bytes` FAILS — the current schema is `z.string().optional()` with no length validation, so a 16-byte key is accepted and `loadConfig` does not throw.

- [ ] **Step 9: Add the refine to the schema.** In `backend/mobile_purchase/src/config/app-config.ts`, replace the `STORE_CREDENTIALS_ENC_KEY` field (line 24-26):

```ts
  // Encryption key for App.storeCredentials (encrypted-at-rest, populated by the connect-store
  // flow). Optional at boot — absence only fails the connect path, not startup. When present it
  // must be a base64 value that decodes to exactly 32 bytes (AES-256), validated here so a
  // misconfigured key fails fast instead of at first encrypt. `.optional()` after `.refine()` so
  // an unset var short-circuits before the refine ever runs.
  STORE_CREDENTIALS_ENC_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length === 32,
      'must be a base64-encoded 32-byte key',
    )
    .optional(),
```

(No change needed in `AppConfig` — `storeCredentialsEncKey?: string` at line 68 stays optional — nor in the `loadConfig` mapping at line 113, which already passes `v.STORE_CREDENTIALS_ENC_KEY` through.)

- [ ] **Step 10: Run the config spec — expect green.**
  - Command: `npx jest src/config/app-config.spec.ts`
  - Expected: all tests pass (existing DASHBOARD_ORIGINS/SCHEDULER cases + the 3 new ones). The reject case now throws `` `Invalid environment configuration:\n  STORE_CREDENTIALS_ENC_KEY: must be a base64-encoded 32-byte key` ``, matching `/STORE_CREDENTIALS_ENC_KEY/`.

- [ ] **Step 11: Typecheck.**
  - Command: `npm run typecheck`
  - Expected: exits 0.

- [ ] **Step 12: Commit the config hardening + its spec.**
  - `git add backend/mobile_purchase/src/config/app-config.ts backend/mobile_purchase/src/config/app-config.spec.ts`
  - `git commit -m "feat(mobile_purchase): validate STORE_CREDENTIALS_ENC_KEY decodes to 32 bytes"`
  - (No `git add -A`; leave the dashboard/`nav-model.ts`/`demo_config.dart` WIP untouched; no co-author trailer; never add any `.env`/`.p8`/service-account file.)

---

### Task 2 (E2): Store-credential blob types + Zod structural validation + creds-gated live-validation seam

**Files:**
- Create: `backend/mobile_purchase/src/catalog/store-credentials/store-credential.types.ts`
- Create: `backend/mobile_purchase/src/catalog/store-credentials/store-credential-validator.ts`
- Test (create): `backend/mobile_purchase/src/catalog/store-credentials/store-credential.types.spec.ts`
- Test (create): `backend/mobile_purchase/src/catalog/store-credentials/store-credential-validator.spec.ts`

(`src/catalog/store-credentials/` does not exist yet — the two `Write` calls create it. `parseStoreCredentialBlob` verified against real deps: `zod@3.25.76` — `.uuid()`/`.length()`/`.regex()` all confirmed working; `ProblemException` at `src/common/problem-details.ts`; `AppPlatform` at `generated/client` — enum members `IOS`, `ANDROID`, `MACOS`, `AMAZON`, `WEB`. jest config: `preset: ts-jest`, `testMatch: <rootDir>/src/**/*.spec.ts`, single-file = `npx jest <path>`. `tsconfig` `strict: true`.)

**Interfaces:**

Consumes:
- `ProblemException` — `new ProblemException({ status, title, detail?, type?, errors? })`; exposes `.problem.status` (from `src/common/problem-details.ts`).
- `AppPlatform` — string enum `{ IOS, ANDROID, MACOS, AMAZON, WEB }` (from `generated/client`).
- Pattern references (copied EXACTLY): `StoreClient` interface + `GoogleApiStoreClient` (`@Injectable()`, creds-gate throws) + `InMemoryStoreClient` (fluent config + call recording) + `GOOGLE_STORE_CLIENT` token + `buildGoogleStoreClient` factory (from `src/webhooks/google/`).

Produces (later tasks — E3 service, E4 module — depend on these EXACTLY):
- `store-credential.types.ts`:
  - `interface GooglePlayBlob { kind: 'google_play'; serviceAccountJson: string }`
  - `interface AppStoreBlob { kind: 'app_store'; ascIssuerId: string; ascKeyId: string; ascPrivateKeyP8: string; appAppleId: string }`
  - `type StoreCredentialBlob = GooglePlayBlob | AppStoreBlob`
  - `googlePlayBlobSchema`, `appStoreBlobSchema` (Zod)
  - `parseStoreCredentialBlob(platform: AppPlatform, input: unknown): StoreCredentialBlob` (throws `ProblemException` 422 field errors / 409 platform mismatch)
- `store-credential-validator.ts`:
  - `interface StoreCredentialValidatorApp { platform: AppPlatform; bundleId: string | null; packageName: string | null }`
  - `interface StoreCredentialValidator { validate(app: StoreCredentialValidatorApp, blob: StoreCredentialBlob): Promise<{ liveVerified: boolean }> }`
  - `class StoreValidationUnavailableError extends Error`
  - `class StoreApiCredentialValidator implements StoreCredentialValidator` (`@Injectable()`, real creds-gated drop-in — throws)
  - `class InMemoryStoreCredentialValidator implements StoreCredentialValidator` (fluent `resolveWith`/`failWith` + `validateCalls` recording)
  - `const STORE_CREDENTIAL_VALIDATOR = 'STORE_CREDENTIAL_VALIDATOR'`
  - `function buildStoreCredentialValidator(): StoreCredentialValidator`

---

#### Cycle 1 — blob types + `parseStoreCredentialBlob`

- [ ] **Step 1: Write the failing structural-validation spec.**
  Create `backend/mobile_purchase/src/catalog/store-credentials/store-credential.types.spec.ts`:

  ```ts
  import { AppPlatform } from '../../../generated/client';
  import { ProblemException } from '../../common/problem-details';
  import { parseStoreCredentialBlob } from './store-credential.types';

  const VALID_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: 'service_account',
    project_id: 'my-project',
    client_email: 'sa@my-project.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n',
  });

  const VALID_GOOGLE_BLOB = {
    kind: 'google_play',
    serviceAccountJson: VALID_SERVICE_ACCOUNT_JSON,
  };

  const VALID_APPLE_BLOB = {
    kind: 'app_store',
    ascIssuerId: '69a6de70-1234-47e3-e053-5b8c7c11a4d1',
    ascKeyId: 'ABC1234DEF',
    ascPrivateKeyP8: '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG...\n-----END PRIVATE KEY-----\n',
    appAppleId: '1234567890',
  };

  function expectProblemStatus(fn: () => unknown, status: number): void {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(ProblemException);
      expect((err as ProblemException).problem.status).toBe(status);
      return;
    }
    throw new Error(`expected parseStoreCredentialBlob to throw a ProblemException ${status}`);
  }

  describe('parseStoreCredentialBlob', () => {
    describe('happy path', () => {
      it('parses a valid Google Play blob for ANDROID', () => {
        expect(parseStoreCredentialBlob(AppPlatform.ANDROID, VALID_GOOGLE_BLOB)).toEqual({
          kind: 'google_play',
          serviceAccountJson: VALID_SERVICE_ACCOUNT_JSON,
        });
      });

      it('parses a valid App Store blob for IOS', () => {
        expect(parseStoreCredentialBlob(AppPlatform.IOS, VALID_APPLE_BLOB)).toEqual({
          kind: 'app_store',
          ascIssuerId: '69a6de70-1234-47e3-e053-5b8c7c11a4d1',
          ascKeyId: 'ABC1234DEF',
          ascPrivateKeyP8: VALID_APPLE_BLOB.ascPrivateKeyP8,
          appAppleId: '1234567890',
        });
      });
    });

    describe('platform mismatch → 409', () => {
      it('rejects a google_play blob against IOS', () => {
        expectProblemStatus(() => parseStoreCredentialBlob(AppPlatform.IOS, VALID_GOOGLE_BLOB), 409);
      });

      it('rejects an app_store blob against ANDROID', () => {
        expectProblemStatus(() => parseStoreCredentialBlob(AppPlatform.ANDROID, VALID_APPLE_BLOB), 409);
      });
    });

    describe('malformed Google fields → 422', () => {
      it('rejects serviceAccountJson that is not JSON', () => {
        expectProblemStatus(
          () => parseStoreCredentialBlob(AppPlatform.ANDROID, { kind: 'google_play', serviceAccountJson: 'not-json' }),
          422,
        );
      });

      it('rejects service-account JSON with the wrong type', () => {
        const json = JSON.stringify({ type: 'user', project_id: 'p', client_email: 'a@b.c', private_key: 'k' });
        expectProblemStatus(
          () => parseStoreCredentialBlob(AppPlatform.ANDROID, { kind: 'google_play', serviceAccountJson: json }),
          422,
        );
      });

      it('rejects service-account JSON missing client_email', () => {
        const json = JSON.stringify({ type: 'service_account', project_id: 'p', private_key: 'k' });
        expectProblemStatus(
          () => parseStoreCredentialBlob(AppPlatform.ANDROID, { kind: 'google_play', serviceAccountJson: json }),
          422,
        );
      });

      it('rejects a missing serviceAccountJson field', () => {
        expectProblemStatus(() => parseStoreCredentialBlob(AppPlatform.ANDROID, { kind: 'google_play' }), 422);
      });
    });

    describe('malformed Apple fields → 422', () => {
      it('rejects an ascKeyId that is not 10 chars', () => {
        expectProblemStatus(
          () => parseStoreCredentialBlob(AppPlatform.IOS, { ...VALID_APPLE_BLOB, ascKeyId: 'SHORT' }),
          422,
        );
      });

      it('rejects an ascIssuerId that is not a UUID', () => {
        expectProblemStatus(
          () => parseStoreCredentialBlob(AppPlatform.IOS, { ...VALID_APPLE_BLOB, ascIssuerId: 'not-a-uuid' }),
          422,
        );
      });

      it('rejects an ascPrivateKeyP8 without the PEM header', () => {
        expectProblemStatus(
          () => parseStoreCredentialBlob(AppPlatform.IOS, { ...VALID_APPLE_BLOB, ascPrivateKeyP8: 'MIGTAgEA...' }),
          422,
        );
      });

      it('rejects an appAppleId that is not all digits', () => {
        expectProblemStatus(
          () => parseStoreCredentialBlob(AppPlatform.IOS, { ...VALID_APPLE_BLOB, appAppleId: '12ab34' }),
          422,
        );
      });
    });
  });
  ```

- [ ] **Step 2: Run the spec — expect a compile/module failure.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/catalog/store-credentials/store-credential.types.spec.ts
  ```
  Expected: FAIL — `Cannot find module './store-credential.types'` (the impl file does not exist yet).

- [ ] **Step 3: Write the minimal impl.**
  Create `backend/mobile_purchase/src/catalog/store-credentials/store-credential.types.ts`:

  ```ts
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
  ```

- [ ] **Step 4: Run the spec — expect green.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/catalog/store-credentials/store-credential.types.spec.ts
  ```
  Expected: PASS — all 12 tests (2 happy, 2 mismatch-409, 4 Google-422, 4 Apple-422). Rationale for each 422/409 path: a `google_play`/`app_store` blob whose recognized `kind` mismatches the platform is caught by the pre-check → 409; a missing/malformed field (or missing/unrecognized `kind`) falls through to the schema `safeParse` → 422 naming the first bad field.

- [ ] **Step 5: Commit the types + its spec (specific files only — never `git add -A`).**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add \
    backend/mobile_purchase/src/catalog/store-credentials/store-credential.types.ts \
    backend/mobile_purchase/src/catalog/store-credentials/store-credential.types.spec.ts && \
    git commit -m "feat(mobile_purchase): add store-credential blob types + Zod structural validation"
  ```

---

#### Cycle 2 — creds-gated `StoreCredentialValidator` seam

- [ ] **Step 6: Write the failing validator spec.**
  Create `backend/mobile_purchase/src/catalog/store-credentials/store-credential-validator.spec.ts`:

  ```ts
  import { AppPlatform } from '../../../generated/client';
  import type { StoreCredentialBlob } from './store-credential.types';
  import type { StoreCredentialValidatorApp } from './store-credential-validator';
  import {
    InMemoryStoreCredentialValidator,
    StoreApiCredentialValidator,
    StoreValidationUnavailableError,
    buildStoreCredentialValidator,
  } from './store-credential-validator';

  const ANDROID_APP: StoreCredentialValidatorApp = {
    platform: AppPlatform.ANDROID,
    bundleId: null,
    packageName: 'com.myampix.app',
  };

  const IOS_APP: StoreCredentialValidatorApp = {
    platform: AppPlatform.IOS,
    bundleId: 'com.myampix.app',
    packageName: null,
  };

  const GOOGLE_BLOB: StoreCredentialBlob = {
    kind: 'google_play',
    serviceAccountJson: '{"type":"service_account"}',
  };

  const APPLE_BLOB: StoreCredentialBlob = {
    kind: 'app_store',
    ascIssuerId: '69a6de70-1234-47e3-e053-5b8c7c11a4d1',
    ascKeyId: 'ABC1234DEF',
    ascPrivateKeyP8: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n',
    appAppleId: '1234567890',
  };

  describe('InMemoryStoreCredentialValidator', () => {
    it('resolves { liveVerified: true } by default and records the call', async () => {
      const validator = new InMemoryStoreCredentialValidator();

      await expect(validator.validate(ANDROID_APP, GOOGLE_BLOB)).resolves.toEqual({ liveVerified: true });
      expect(validator.validateCalls).toEqual([{ app: ANDROID_APP, blob: GOOGLE_BLOB }]);
    });

    it('resolves { liveVerified: false } when configured', async () => {
      const validator = new InMemoryStoreCredentialValidator().resolveWith(false);

      await expect(validator.validate(IOS_APP, APPLE_BLOB)).resolves.toEqual({ liveVerified: false });
    });

    it('throws StoreValidationUnavailableError when configured, still recording the call', async () => {
      const validator = new InMemoryStoreCredentialValidator().failWith(
        new StoreValidationUnavailableError(AppPlatform.ANDROID),
      );

      await expect(validator.validate(ANDROID_APP, GOOGLE_BLOB)).rejects.toBeInstanceOf(StoreValidationUnavailableError);
      expect(validator.validateCalls).toEqual([{ app: ANDROID_APP, blob: GOOGLE_BLOB }]);
    });

    it('throws a generic store error when configured (the 502 "store rejected" branch)', async () => {
      const storeError = new Error('store rejected the credentials');
      const validator = new InMemoryStoreCredentialValidator().failWith(storeError);

      await expect(validator.validate(ANDROID_APP, GOOGLE_BLOB)).rejects.toBe(storeError);
    });
  });

  describe('StoreApiCredentialValidator (creds-gated real impl)', () => {
    it('throws StoreValidationUnavailableError for a Google Play credential', async () => {
      const validator = new StoreApiCredentialValidator();

      await expect(validator.validate(ANDROID_APP, GOOGLE_BLOB)).rejects.toBeInstanceOf(StoreValidationUnavailableError);
    });

    it('throws StoreValidationUnavailableError for an App Store credential', async () => {
      const validator = new StoreApiCredentialValidator();

      await expect(validator.validate(IOS_APP, APPLE_BLOB)).rejects.toBeInstanceOf(StoreValidationUnavailableError);
    });
  });

  describe('buildStoreCredentialValidator', () => {
    it('builds the real creds-gated validator', async () => {
      const validator = buildStoreCredentialValidator();

      expect(validator).toBeInstanceOf(StoreApiCredentialValidator);
      await expect(validator.validate(ANDROID_APP, GOOGLE_BLOB)).rejects.toBeInstanceOf(StoreValidationUnavailableError);
    });
  });
  ```

- [ ] **Step 7: Run the spec — expect a module failure.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/catalog/store-credentials/store-credential-validator.spec.ts
  ```
  Expected: FAIL — `Cannot find module './store-credential-validator'`.

- [ ] **Step 8: Write the validator impl (copies the `StoreClient` seam pattern EXACTLY).**
  Create `backend/mobile_purchase/src/catalog/store-credentials/store-credential-validator.ts`:

  ```ts
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
    constructor(platform?: AppPlatform) {
      super(
        `Live store validation is not available${platform ? ` for platform "${platform}"` : ''} — the ` +
          'store SDKs are not wired and no real store credentials exist yet (design §1.3, mirrors ' +
          "GoogleApiStoreClient's creds gate); the connect flow records liveVerified=false / pending",
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
      throw new StoreValidationUnavailableError(app.platform);
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
  ```

- [ ] **Step 9: Run the spec — expect green.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/catalog/store-credentials/store-credential-validator.spec.ts
  ```
  Expected: PASS — all 7 tests (4 InMemory branches: default-true / false / unavailable-error / generic-error; 2 real-impl throws Google + Apple; 1 factory builds `StoreApiCredentialValidator`).

- [ ] **Step 10: Run both E2 specs together (confirm no cross-file regression).**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/catalog/store-credentials/
  ```
  Expected: PASS — 2 suites, 19 tests.

- [ ] **Step 11: Commit the validator + its spec (specific files only).**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add \
    backend/mobile_purchase/src/catalog/store-credentials/store-credential-validator.ts \
    backend/mobile_purchase/src/catalog/store-credentials/store-credential-validator.spec.ts && \
    git commit -m "feat(mobile_purchase): add creds-gated store-credential validator seam + InMemory double"
  ```

---

**Task-2 done-when:** both new impl files exist under `src/catalog/store-credentials/`; both specs green (`npx jest src/catalog/store-credentials/` → 2 suites / 19 tests); no co-author trailer; only the four E2 files staged in the two commits; no `.env`/secret/`.p8`/service-account JSON committed (test fixtures use inline placeholder strings, never real keys).

---

### Task 3 (E3): App status-columns migration + StoreCredentialsService + Testcontainers spec

**Depends on:** E1 (`store-credentials-cipher.ts`) and E2 (`store-credential.types.ts`, `store-credential-validator.ts`) are already merged (build order E1 → E2 → E3). This task does NOT touch `catalog.module.ts` — the DI wiring of `StoreCredentialsService` + `STORE_CREDENTIAL_VALIDATOR` is E4's job. The spec here constructs the service directly (no Nest DI), exactly like `refund.service.spec.ts`.

**Files:**
- Modify: `backend/mobile_purchase/prisma/schema.prisma` (App model — two additive status columns)
- Create: `backend/mobile_purchase/prisma/migrations/<timestamp>_store_credentials_status/migration.sql` (generated by `prisma migrate dev`; timestamp is assigned by Prisma)
- Create: `backend/mobile_purchase/src/catalog/store-credentials/store-credentials.service.ts`
- Test: `backend/mobile_purchase/src/catalog/store-credentials/store-credentials.service.spec.ts`

**Interfaces:**

Consumes (exact signatures from E1/E2 and existing code):
- E1 `../../common/crypto/store-credentials-cipher`: `encryptStoreCredentials(plaintext: string, keyB64: string): string`, `decryptStoreCredentials(blob: string, keyB64: string): string`, `class StoreCipherError extends Error`.
- E2 `./store-credential.types`: `parseStoreCredentialBlob(platform: AppPlatform, input: unknown): StoreCredentialBlob` (throws `ProblemException` 422 on structural failure, 409 on `kind`/platform mismatch); `type StoreCredentialBlob = GooglePlayBlob | AppStoreBlob`.
- E2 `./store-credential-validator`: `interface StoreCredentialValidator { validate(app: ValidatorApp, blob: StoreCredentialBlob): Promise<{ liveVerified: boolean }> }` where `ValidatorApp = { id: string; projectId: string; platform: AppPlatform; bundleId: string | null; packageName: string | null }`; `class StoreValidationUnavailableError extends Error` (constructible with a message string); `const STORE_CREDENTIAL_VALIDATOR = 'STORE_CREDENTIAL_VALIDATOR'`; test double `class InMemoryStoreCredentialValidator implements StoreCredentialValidator` with `readonly validateCalls: Array<{ app: ValidatorApp; blob: StoreCredentialBlob }>`, fluent `resolveWith(result: { liveVerified: boolean }): this` (default resolves `{ liveVerified: true }`) and `failWith(error: Error): this`.
- `../../config/app-config`: `const APP_CONFIG = 'APP_CONFIG'`; `interface AppConfig { … storeCredentialsEncKey?: string … }`.
- `../../common/problem-details`: `class ProblemException` (`new ProblemException({ status, title, detail? })`, exposes `.problem`).
- `../../prisma/prisma.service`: `PrismaService`.
- `../../../generated/client`: `AppPlatform`.
- `../../../test/integration/helpers/containers`: `startPostgresContainer(): Promise<{ container: StartedPostgreSqlContainer; url: string }>`.

Produces (later tasks rely on these EXACT names):
- Schema: `App.storeCredentialsVerifiedAt DateTime? @map("store_credentials_verified_at")`, `App.storeCredentialsLiveVerified Boolean @default(false) @map("store_credentials_live_verified")`. Migration name `store_credentials_status`.
- `export interface StoreCredentialStatus { connected: boolean; platform: AppPlatform; liveVerified: boolean; verifiedAt: Date | null }`.
- `export class StoreCredentialsService` — `set(projectId: string, appId: string, input: unknown, nowMs?: number): Promise<StoreCredentialStatus>`, `status(projectId: string, appId: string): Promise<StoreCredentialStatus>`, `disconnect(projectId: string, appId: string): Promise<void>`. (E4 wires + calls it; E7 renders the returned status.)

---

#### Cycle 1 — additive migration (schema + status columns)

- [ ] **Step 1: Add the two non-secret status columns to the App model.** Edit `backend/mobile_purchase/prisma/schema.prisma`, inserting the two fields immediately after the existing `storeCredentials` line (keep the existing comment above it):

```prisma
  // Store credentials, encrypted at rest. Column modeled now; POPULATED by a later connect-store
  // flow (nullable until then). Encryption uses a dedicated key (STORE_CREDENTIALS_ENC_KEY).
  storeCredentials String?     @map("store_credentials") // encrypted JSON blob, null until connected
  // Non-secret connection status (connect-stores E3): status reads NEVER decrypt the blob above.
  // `storeCredentialsLiveVerified` = a live store validation succeeded; `…VerifiedAt` = when (null
  // while `connected` but live-verify still pending — the creds-gated validator was unavailable).
  storeCredentialsVerifiedAt   DateTime?   @map("store_credentials_verified_at")
  storeCredentialsLiveVerified Boolean     @default(false) @map("store_credentials_live_verified")
  createdAt        DateTime    @default(now()) @map("created_at")
  products         Product[]
```

- [ ] **Step 2: Generate the migration against a throwaway DB.** Mirrors how prior migrations were added (a fresh `postgres:17-alpine`, the same image Testcontainers boots — no dependency on `infra/docker-compose.yml` and no `.env` in this service). `migrate dev` applies the existing 7 migrations to the fresh DB, creates the 8th from the schema diff, then auto-runs `prisma generate`:

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase
docker run --rm -d --name mp-migrate-throwaway -e POSTGRES_PASSWORD=postgres -p 5599:5432 postgres:17-alpine
until docker exec mp-migrate-throwaway pg_isready -U postgres >/dev/null 2>&1; do sleep 0.5; done
DATABASE_URL="postgresql://postgres:postgres@localhost:5599/postgres?schema=public" \
  npx prisma migrate dev --name store_credentials_status
docker rm -f mp-migrate-throwaway
```

Expected: Prisma writes `prisma/migrations/<timestamp>_store_credentials_status/migration.sql` and prints `Your database is now in sync with your schema` + `✔ Generated Prisma Client`. The generated `migration.sql` MUST read exactly (additive-only, no data migration):

```sql
-- AlterTable
ALTER TABLE "apps" ADD COLUMN     "store_credentials_live_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "store_credentials_verified_at" TIMESTAMP(3);
```

- [ ] **Step 3: Verify the generated client picked up the fields (type-check).** The `App` type in `generated/client` must now expose both fields; this makes the spec below compile:

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase
npx tsc --noEmit
```

Expected: exits 0 (no new type errors). If `generated/client` is stale, re-run `npx prisma generate`.

- [ ] **Step 4: Commit the migration + schema (only these two paths).** Never `git add -A` (protects the user's collapse-rail WIP):

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix
git add backend/mobile_purchase/prisma/schema.prisma \
        backend/mobile_purchase/prisma/migrations/*_store_credentials_status/migration.sql
git commit -m "feat(mobile_purchase): add App store-credential status columns migration"
```

---

#### Cycle 2 — StoreCredentialsService (TDD)

- [ ] **Step 5: Write the failing Testcontainers spec (full).** Create `backend/mobile_purchase/src/catalog/store-credentials/store-credentials.service.spec.ts`:

```ts
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
    validator.resolveWith({ liveVerified: true });

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
    expect(validator.validateCalls[0].app.id).toBe(app.id);
    expect(validator.validateCalls[0].blob).toEqual(GOOGLE_INPUT);

    const reloaded = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    expect(reloaded.storeCredentials).not.toBeNull();
    expect(reloaded.storeCredentials).not.toContain('service_account'); // encrypted, not plaintext
    expect(reloaded.storeCredentialsLiveVerified).toBe(true);
    expect(reloaded.storeCredentialsVerifiedAt).toEqual(new Date(NOW_MS));
  });

  it('set (Apple, live-verified): routes IOS -> app_store and persists', async () => {
    const app = await seedIosApp();
    validator.resolveWith({ liveVerified: true });

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
    validator.resolveWith({ liveVerified: true });
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
    validator.resolveWith({ liveVerified: true });
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
    validator.resolveWith({ liveVerified: true });
    await service.set(projectId, app.id, GOOGLE_INPUT, NOW_MS);

    const reloaded = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
    const decrypted = JSON.parse(decryptStoreCredentials(reloaded.storeCredentials as string, TEST_ENC_KEY));

    expect(decrypted).toEqual(GOOGLE_INPUT);
  });
});
```

- [ ] **Step 6: Run the spec — it fails (the service file does not exist).**

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase
npx jest src/catalog/store-credentials/store-credentials.service.spec.ts
```

Expected: compile failure — `Cannot find module './store-credentials.service'` (the `StoreCredentialsService` import cannot resolve). Zero tests run.

- [ ] **Step 7: Write the minimal service (full).** Create `backend/mobile_purchase/src/catalog/store-credentials/store-credentials.service.ts`:

```ts
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
    let liveVerified: boolean;
    try {
      const result = await this.validator.validate(app, blob);
      liveVerified = result.liveVerified;
    } catch (e) {
      if (e instanceof StoreValidationUnavailableError) {
        liveVerified = false;
      } else {
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
```

- [ ] **Step 8: Run the spec — it passes.**

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase
npx jest src/catalog/store-credentials/store-credentials.service.spec.ts
```

Expected: all specs green (`Tests: 15 passed`), Testcontainers boots one `postgres:17-alpine`, applies migrations (including `store_credentials_status`), tears down cleanly.

- [ ] **Step 9: Type-check the whole service compiles.**

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 10: Commit the service + spec (only these two paths).**

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix
git add backend/mobile_purchase/src/catalog/store-credentials/store-credentials.service.ts \
        backend/mobile_purchase/src/catalog/store-credentials/store-credentials.service.spec.ts
git commit -m "feat(mobile_purchase): add StoreCredentialsService (set/status/disconnect) + Testcontainers spec"
```

---

### Task 4 (E4): Store-credentials controller endpoints + apps-list `storeConnected` + catalog wiring + e2e

**Controller-grouping decision (stated per CONTRACT):** the three routes go **on the existing `AppsController`**, NOT a new `StoreCredentialsController`. Reason: every app-level route in the catalog domain is already grouped on one controller per resource (`AppsController` owns `GET/POST /apps` + `DELETE /apps/:appId`; `ProductsController` owns its `products/:productId/entitlements` attach/detach sub-resource on the same controller). The `store-credentials` routes are all app-scoped under `:appId`, so they belong on `AppsController` — mirroring how products keep their entitlement sub-resource on `ProductsController`. No new controller is registered; `catalog.module.ts` only gains the two new providers.

**Files:**
- Modify: `backend/mobile_purchase/src/catalog/services/apps.service.ts` (add derived `storeConnected` to `list`)
- Modify: `backend/mobile_purchase/src/catalog/controllers/apps.controller.ts` (add PUT / GET-status / DELETE + inject `StoreCredentialsService`)
- Modify: `backend/mobile_purchase/src/catalog/catalog.module.ts` (provide `StoreCredentialsService` + `STORE_CREDENTIAL_VALIDATOR` factory)
- Test: `backend/mobile_purchase/test/e2e/store-credentials.e2e-spec.ts` (new)

**Interfaces:**
- Consumes (E3): `StoreCredentialsService` @ `src/catalog/store-credentials/store-credentials.service.ts` — `set(projectId: string, appId: string, input: unknown, nowMs?: number): Promise<StoreCredentialStatus>`; `status(projectId: string, appId: string): Promise<StoreCredentialStatus>`; `disconnect(projectId: string, appId: string): Promise<void>`; `interface StoreCredentialStatus { connected: boolean; platform: AppPlatform; liveVerified: boolean; verifiedAt: Date | null }`.
- Consumes (E2): `STORE_CREDENTIAL_VALIDATOR` DI token + `buildStoreCredentialValidator()` factory + `InMemoryStoreCredentialValidator` double, all @ `src/catalog/store-credentials/store-credential-validator.ts` (mirrors `GOOGLE_STORE_CLIENT` + `buildGoogleStoreClient` @ `src/webhooks/google/google-store-client.factory.ts`).
- Consumes (existing): `ProjectAccessGuard` (`src/authz/project-access.guard.ts`), `@RequireProjectRole` (`src/authz/require-project-role.decorator.ts`), `APP_CONFIG` is `@Global()` (`src/config/config.module.ts`) so `StoreCredentialsService`'s `@Inject(APP_CONFIG)` resolves without a module import.
- Produces (E6/E7 rely on): route `PUT /api/v1/projects/:projectId/catalog/apps/:appId/store-credentials` → 200 `StoreCredentialStatus`; `GET …/store-credentials/status` → 200 `StoreCredentialStatus`; `DELETE …/store-credentials` → 204; and a `storeConnected: boolean` field on every item of `GET /api/v1/projects/:projectId/catalog/apps`.

---

#### Cycle 1 — apps-list `storeConnected` (service-only, seeded directly so it needs no endpoint yet)

- [ ] **Step 1: Write the failing e2e file with ONLY the `storeConnected` list test.** Create `backend/mobile_purchase/test/e2e/store-credentials.e2e-spec.ts`. This first version boots once and overrides only `ProjectAccessService` (the `STORE_CREDENTIAL_VALIDATOR` token is not registered until Cycle 2, so it is NOT overridden here). It seeds `storeCredentials` directly via Prisma (a dummy dot-joined string — the derivation is null-ness only, never decryption).

```ts
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
```

- [ ] **Step 2: Run — expect red.** From `backend/mobile_purchase`:
  `npx jest test/e2e/store-credentials.e2e-spec.ts`
  Expected failure: the assertions fail — `connected.storeConnected` is `undefined` (the list does not yet derive the field), so `toMatchObject({ storeConnected: true })` fails.

- [ ] **Step 3: Add `storeConnected` to `AppsService.list`.** In `backend/mobile_purchase/src/catalog/services/apps.service.ts`, replace the existing `list` method:

  Existing:
```ts
  list(projectId: string) {
    return this.prisma.app.findMany({
      where: { projectId },
      omit: { storeCredentials: true },
      orderBy: { createdAt: 'asc' },
    });
  }
```

  New:
```ts
  async list(projectId: string) {
    const apps = await this.prisma.app.findMany({
      where: { projectId },
      // storeCredentials is the encrypted-at-rest blob — never echo it (design §1.4). Keep the omit
      // so the returned shape is unchanged apart from the derived flag below.
      omit: { storeCredentials: true },
      orderBy: { createdAt: 'asc' },
    });
    // Derive `storeConnected` WITHOUT loading the ciphertext: a second, blob-free query filters on
    // null-ness in-DB and selects only the id, so the encrypted value never reaches the server.
    const connected = await this.prisma.app.findMany({
      where: { projectId, storeCredentials: { not: null } },
      select: { id: true },
    });
    const connectedIds = new Set(connected.map((a) => a.id));
    return apps.map((app) => ({ ...app, storeConnected: connectedIds.has(app.id) }));
  }
```

- [ ] **Step 4: Run — expect green.** From `backend/mobile_purchase`:
  `npx jest test/e2e/store-credentials.e2e-spec.ts`
  Expected: 1 passing test.

- [ ] **Step 5: Commit (specific files only — never `git add -A`).**
```bash
git add backend/mobile_purchase/src/catalog/services/apps.service.ts \
        backend/mobile_purchase/test/e2e/store-credentials.e2e-spec.ts
git commit -m "feat(mobile_purchase): derive storeConnected on the catalog apps list"
```

---

#### Cycle 2 — the three endpoints + catalog module wiring

- [ ] **Step 6: Extend the e2e file with the endpoint tests + the validator/enc-key harness.** Edit `backend/mobile_purchase/test/e2e/store-credentials.e2e-spec.ts`: add two imports at the top, set `STORE_CREDENTIALS_ENC_KEY` + override `STORE_CREDENTIAL_VALIDATOR` in `beforeAll`, and append the endpoint `it` blocks. The file becomes:

  Add to the import block (after the existing `PrismaService` import):
```ts
import { STORE_CREDENTIAL_VALIDATOR, InMemoryStoreCredentialValidator } from '../../src/catalog/store-credentials/store-credential-validator';
```

  Add a shared validator double just below `fakeAccess` field decls (inside `describe`, before `beforeAll`):
```ts
  // One shared InMemory validator bound over STORE_CREDENTIAL_VALIDATOR for the whole file (the app
  // boots once — same single-instance pattern the refund e2e uses for GOOGLE_STORE_CLIENT). Its
  // default `validate()` resolution drives the set flow; the test asserts on liveVerified as a
  // boolean so it is agnostic to that default.
  const validator = new InMemoryStoreCredentialValidator();
```

  Replace the `beforeAll` body's env setup + compile with (adds the enc key + the validator override):
```ts
  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    process.env.DATABASE_URL = started.url.replace(/^postgres:\/\//, 'postgresql://');
    process.env.NODE_ENV = 'test';
    // 32 raw bytes, base64 — satisfies E1's Zod refine (base64 -> exactly 32 bytes). Without it the
    // set flow returns 503; with it the encrypt path runs.
    process.env.STORE_CREDENTIALS_ENC_KEY = Buffer.alloc(32, 7).toString('base64');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProjectAccessService)
      .useClass(FakeProjectAccessService)
      .overrideProvider(STORE_CREDENTIAL_VALIDATOR)
      .useValue(validator)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    fakeAccess = app.get(ProjectAccessService) as unknown as FakeProjectAccessService;
  });
```

  Append these helpers + tests inside the `describe` (after the Cycle-1 `it`):
```ts
  /** A structurally-valid Google Play service-account blob (E2 rules: JSON, type==='service_account',
   * client_email, private_key, project_id). */
  function validGoogleBlob() {
    return {
      kind: 'google_play',
      serviceAccountJson: JSON.stringify({
        type: 'service_account',
        project_id: 'demo-project',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIfakekeymaterial\n-----END PRIVATE KEY-----\n',
        client_email: 'sa@demo-project.iam.gserviceaccount.com',
      }),
    };
  }

  async function seedAndroidApp(projectId: string) {
    return prisma.app.create({
      data: {
        projectId,
        name: 'Android',
        platform: 'ANDROID',
        packageName: `com.store.e2e.${randomUUID()}`,
        publicSdkKey: `mp_pub_${randomUUID()}`,
      },
    });
  }

  function credsPath(projectId: string, appId: string): string {
    return `/api/v1/projects/${projectId}/catalog/apps/${appId}/store-credentials`;
  }

  it('PUT store-credentials — 200 as admin: returns StoreCredentialStatus (connected), never the secret; blob is stored', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    const res = await request(http)
      .put(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .send(validGoogleBlob())
      .expect(200);

    expect(res.body).toMatchObject({ connected: true, platform: 'ANDROID' });
    expect(typeof res.body.liveVerified).toBe('boolean');
    // verifiedAt tracks liveVerified: a live-verified set stamps a date, a pending one stays null.
    if (res.body.liveVerified) {
      expect(typeof res.body.verifiedAt).toBe('string');
    } else {
      expect(res.body.verifiedAt).toBeNull();
    }
    // The secret is NEVER returned.
    expect(res.body).not.toHaveProperty('storeCredentials');
    expect(res.body).not.toHaveProperty('serviceAccountJson');

    // The encrypted blob was actually persisted (not the plaintext JSON).
    const persisted = await prisma.app.findUnique({ where: { id: androidApp.id } });
    expect(persisted?.storeCredentials).not.toBeNull();
    expect(persisted?.storeCredentials).not.toContain('service_account');

    // …and the apps list now reports storeConnected: true for it.
    const list = await request(http)
      .get(`/api/v1/projects/${projectId}/catalog/apps`)
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(list.body.find((a: { id: string }) => a.id === androidApp.id)).toMatchObject({ storeConnected: true });
  });

  it('PUT store-credentials — 403 as viewer (nothing written)', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    fakeAccess.role = 'viewer';
    await request(http)
      .put(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer viewer-token')
      .send(validGoogleBlob())
      .expect(403);

    const persisted = await prisma.app.findUnique({ where: { id: androidApp.id } });
    expect(persisted?.storeCredentials).toBeNull();
  });

  it('PUT store-credentials — 401 without an Authorization header', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    await request(http)
      .put(credsPath(projectId, androidApp.id))
      .send(validGoogleBlob())
      .expect(401);
  });

  it('PUT store-credentials — 404 for an unknown appId', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await request(http)
      .put(credsPath(projectId, randomUUID()))
      .set('Authorization', 'Bearer admin-token')
      .send(validGoogleBlob())
      .expect(404);
  });

  it('PUT store-credentials — 422 for a structurally-malformed blob', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    await request(http)
      .put(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .send({ kind: 'google_play', serviceAccountJson: '{ not valid json' })
      .expect(422);

    const persisted = await prisma.app.findUnique({ where: { id: androidApp.id } });
    expect(persisted?.storeCredentials).toBeNull();
  });

  it('GET store-credentials/status — 200 as viewer, connected reflects a prior admin set, secret never returned', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    fakeAccess.role = 'admin';
    await request(http)
      .put(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .send(validGoogleBlob())
      .expect(200);

    fakeAccess.role = 'viewer';
    const res = await request(http)
      .get(`${credsPath(projectId, androidApp.id)}/status`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);

    expect(res.body).toMatchObject({ connected: true, platform: 'ANDROID' });
    expect(res.body).not.toHaveProperty('storeCredentials');
    expect(res.body).not.toHaveProperty('serviceAccountJson');
  });

  it('DELETE store-credentials — 204 as admin, idempotent on repeat, clears storeConnected', async () => {
    const projectId = randomUUID();
    const http = app.getHttpServer();
    const androidApp = await seedAndroidApp(projectId);

    fakeAccess.role = 'admin';
    await request(http)
      .put(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .send(validGoogleBlob())
      .expect(200);

    // viewer cannot disconnect
    fakeAccess.role = 'viewer';
    await request(http)
      .delete(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer viewer-token')
      .expect(403);

    fakeAccess.role = 'admin';
    await request(http)
      .delete(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .expect(204);

    expect((await prisma.app.findUnique({ where: { id: androidApp.id } }))?.storeCredentials).toBeNull();

    // idempotent: disconnecting an already-disconnected app is still a 204 no-op
    await request(http)
      .delete(credsPath(projectId, androidApp.id))
      .set('Authorization', 'Bearer admin-token')
      .expect(204);

    const status = await request(http)
      .get(`${credsPath(projectId, androidApp.id)}/status`)
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(status.body).toMatchObject({ connected: false });

    const list = await request(http)
      .get(`/api/v1/projects/${projectId}/catalog/apps`)
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(list.body.find((a: { id: string }) => a.id === androidApp.id)).toMatchObject({ storeConnected: false });
  });
```

- [ ] **Step 7: Run — expect red.** From `backend/mobile_purchase`:
  `npx jest test/e2e/store-credentials.e2e-spec.ts`
  Expected failure: the module fails to compile (`overrideProvider(STORE_CREDENTIAL_VALIDATOR)` targets a token not yet registered in `CatalogModule`, and `AppsController` has no `store-credentials` routes) — the endpoint tests error / return 404. (If the override throws "Nest could not find STORE_CREDENTIAL_VALIDATOR", that is the expected red until Step 9.)

- [ ] **Step 8: Add the three routes to `AppsController`.** In `backend/mobile_purchase/src/catalog/controllers/apps.controller.ts`, add `Put` to the `@nestjs/common` import, import `StoreCredentialsService`, inject it, and append the three handlers. Full file:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../common/zod';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { createAppSchema } from '../support/catalog.schemas';
import { AppsService } from '../services/apps.service';
import { StoreCredentialsService } from '../store-credentials/store-credentials.service';

@Controller('api/v1/projects/:projectId/catalog/apps')
@UseGuards(ProjectAccessGuard)
export class AppsController {
  constructor(
    private readonly service: AppsService,
    private readonly storeCredentials: StoreCredentialsService,
  ) {}

  @Get()
  @RequireProjectRole('viewer')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @RequireProjectRole('admin')
  create(@Param('projectId') projectId: string, @Body() body: unknown) {
    return this.service.create(projectId, parseOrThrow(createAppSchema, body));
  }

  @Delete(':appId')
  @HttpCode(204)
  @RequireProjectRole('admin')
  remove(@Param('projectId') projectId: string, @Param('appId') appId: string) {
    return this.service.remove(projectId, appId);
  }

  // --- store-credentials sub-resource (design §1.4). Grouped on AppsController — not a separate
  // controller — because every route is app-scoped under :appId, exactly like ProductsController
  // owns its products/:productId/entitlements sub-resource. Admin writes, viewer status read;
  // the encrypted blob is never returned by any of them. ---

  @Put(':appId/store-credentials')
  @RequireProjectRole('admin')
  setStoreCredentials(
    @Param('projectId') projectId: string,
    @Param('appId') appId: string,
    @Body() body: unknown,
  ) {
    // PUT defaults to HTTP 200 in Nest; the StoreCredentialStatus is returned, never the secret.
    return this.storeCredentials.set(projectId, appId, body);
  }

  @Get(':appId/store-credentials/status')
  @RequireProjectRole('viewer')
  storeCredentialsStatus(
    @Param('projectId') projectId: string,
    @Param('appId') appId: string,
  ) {
    return this.storeCredentials.status(projectId, appId);
  }

  @Delete(':appId/store-credentials')
  @HttpCode(204)
  @RequireProjectRole('admin')
  disconnectStoreCredentials(
    @Param('projectId') projectId: string,
    @Param('appId') appId: string,
  ) {
    return this.storeCredentials.disconnect(projectId, appId);
  }
}
```

- [ ] **Step 9: Wire the providers into `CatalogModule`.** In `backend/mobile_purchase/src/catalog/catalog.module.ts`, add the two imports and the two providers (`StoreCredentialsService` + the `STORE_CREDENTIAL_VALIDATOR` factory). `APP_CONFIG` is already `@Global()`, so `StoreCredentialsService`'s `@Inject(APP_CONFIG)` resolves without importing `AppConfigModule` here. Full file:

```ts
import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { AppsController } from './controllers/apps.controller';
import { EntitlementsController } from './controllers/entitlements.controller';
import { ProductsController } from './controllers/products.controller';
import { OfferingsController } from './controllers/offerings.controller';
import { PublicOfferingsController } from './controllers/public-offerings.controller';
import { AppsService } from './services/apps.service';
import { EntitlementsService } from './services/entitlements.service';
import { ProductsService } from './services/products.service';
import { OfferingsService } from './services/offerings.service';
import { OfferingResolverService } from './services/offering-resolver.service';
import { PublicApiKeyGuard } from './public-api-key.guard';
import { StoreCredentialsService } from './store-credentials/store-credentials.service';
import { STORE_CREDENTIAL_VALIDATOR, buildStoreCredentialValidator } from './store-credentials/store-credential-validator';

/**
 * Mounts the catalog domain's controllers. AuthzModule provides ProjectAccessGuard (used by every
 * admin-facing controller below); PrismaModule is @Global() so PrismaService needs no import
 * here. OfferingResolverService is exported so a future purchase-recording flow can resolve the
 * current offering without re-mounting this module. AppsService is exported so M2b's Apple ingest
 * (WebhooksModule) can resolve an App by bundleId without re-mounting this module.
 * PublicApiKeyGuard is exported so M5a's SubscribersModule (`GET /v1/subscribers/:appUserId`) can
 * reuse the exact same `publicSdkKey` authentication `/v1/offerings` uses, without re-mounting
 * this module. StoreCredentialsService (E4 design §1.4) backs the store-credentials routes on
 * AppsController; STORE_CREDENTIAL_VALIDATOR is wired like WebhooksModule's GOOGLE_STORE_CLIENT —
 * the real creds-gated validator in the running app, overridden with an InMemory double in specs.
 */
@Module({
  imports: [AuthzModule],
  controllers: [AppsController, EntitlementsController, ProductsController, OfferingsController, PublicOfferingsController],
  providers: [
    AppsService,
    EntitlementsService,
    ProductsService,
    OfferingsService,
    OfferingResolverService,
    PublicApiKeyGuard,
    StoreCredentialsService,
    {
      provide: STORE_CREDENTIAL_VALIDATOR,
      useFactory: () => buildStoreCredentialValidator(),
    },
  ],
  exports: [OfferingResolverService, AppsService, PublicApiKeyGuard],
})
export class CatalogModule {}
```

- [ ] **Step 10: Run — expect green.** From `backend/mobile_purchase`:
  `npx jest test/e2e/store-credentials.e2e-spec.ts`
  Expected: all tests pass (Cycle-1 list test + the 7 endpoint tests: 200 admin set / 403 viewer PUT / 401 / 404 unknown app / 422 malformed / GET status viewer 200 / DELETE admin 204 + idempotent, plus storeConnected true after set).

- [ ] **Step 11: Typecheck.** From `backend/mobile_purchase`: `npm run typecheck` — expect exit 0 (no errors).

- [ ] **Step 12: Commit (specific files only — never `git add -A`).**
```bash
git add backend/mobile_purchase/src/catalog/controllers/apps.controller.ts \
        backend/mobile_purchase/src/catalog/catalog.module.ts \
        backend/mobile_purchase/test/e2e/store-credentials.e2e-spec.ts
git commit -m "feat(mobile_purchase): store-credentials PUT/GET-status/DELETE endpoints + catalog wiring"
```

**Notes for neighboring authors:** No co-author trailer. Only the four E4 files are ever `git add`-ed. `STORE_CREDENTIALS_ENC_KEY` / `.p8` / service-account JSON never leave the test fixtures (the e2e's key is `Buffer.alloc(32, 7)`, not a real credential). The `buildStoreCredentialValidator()` factory + `InMemoryStoreCredentialValidator` + `STORE_CREDENTIAL_VALIDATOR` token are E2's deliverables (mirrored on `GOOGLE_STORE_CLIENT`); the `InMemoryStoreCredentialValidator`'s default `validate()` resolution drives the set flow — the e2e asserts `liveVerified` as a boolean so it is agnostic to whether that default is verified-or-pending.

---

### Task 5 (E5): Decrypt wiring into `GoogleApiStoreClient.requireCredentials`

**Files:**
- Modify: `backend/mobile_purchase/src/webhooks/google/store-client.google-api.ts` (`requireCredentials` decrypts + `JSON.parse` → returns the Google service account; new `GoogleServiceAccount` export; constructor gains optional `encKey`; broadened `GoogleCredentialsUnavailableError` reason)
- Modify: `backend/mobile_purchase/src/webhooks/google/google-store-client.factory.ts` (`buildGoogleStoreClient` gains `encKey?: string`)
- Modify: `backend/mobile_purchase/src/webhooks/webhooks.module.ts` (`GOOGLE_STORE_CLIENT` factory injects `APP_CONFIG`, passes `config.storeCredentialsEncKey`)
- Test: `backend/mobile_purchase/src/webhooks/google/store-client.google-api.spec.ts` (extend the existing `fakePrisma` unit spec — no Testcontainers)

**Interfaces:**
- Consumes (E1 cipher, `backend/mobile_purchase/src/common/crypto/store-credentials-cipher.ts`): `encryptStoreCredentials(plaintext: string, keyB64: string): string`, `decryptStoreCredentials(blob: string, keyB64: string): string`, `class StoreCipherError extends Error`. Output format = `base64(iv).base64(tag).base64(ciphertext)`; `keyB64` decodes to exactly 32 bytes else `StoreCipherError`; tamper/auth-tag failure throws `StoreCipherError`.
- Consumes (config, `backend/mobile_purchase/src/config/app-config.ts`): `APP_CONFIG` DI token, `AppConfig.storeCredentialsEncKey?: string` (always populated by `loadConfig`, `undefined` when `STORE_CREDENTIALS_ENC_KEY` unset).
- Consumes (existing): `PrismaService`, `AppPlatform.ANDROID`, `StoreClient` interface, existing `GoogleCredentialsUnavailableError`.
- Produces (later tasks / existing callers rely on): `GoogleApiStoreClient` still implements `StoreClient` unchanged (`getSubscriptionV2`/`getProduct`/`revokeAndRefundSubscription` STILL throw `GoogleCredentialsUnavailableError` — network stays gated). New export `interface GoogleServiceAccount`. `buildGoogleStoreClient(prisma, encKey?)`. Private `requireCredentials(packageName): Promise<GoogleServiceAccount>` now returns the parsed SA when a valid cred + key are present.

> Prerequisite (build order): E1 (`store-credentials-cipher.ts`) must be landed before this task — the impl and the test both import `decrypt/encryptStoreCredentials` from it. Do not start E5 until E1's `npx jest src/common/crypto/store-credentials-cipher.spec.ts` is green.

---

- [ ] **Step 1: Write the failing decrypt-path spec (extend the existing unit spec).**
  Replace the entire contents of `backend/mobile_purchase/src/webhooks/google/store-client.google-api.spec.ts` with the block below. It keeps the two original null-cred cases, KEEPS the two "still throws when constructed without a key" cases (unchanged behavior: no key → gated), and ADDS the E5 cases: `requireCredentials` returns the parsed SA for a real encrypted cred + key; throws when the key is missing; throws when decrypt fails (tampered/garbage blob); and the network stays gated even with a valid cred + key.

  ```ts
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
  ```

- [ ] **Step 2: Run the spec — expect a compile/assertion failure.**
  From `backend/mobile_purchase`:
  ```bash
  npx jest src/webhooks/google/store-client.google-api.spec.ts
  ```
  Expected failure: TS compile error — `store-client.google-api.ts` has no exported `GoogleServiceAccount`, the constructor rejects the 2nd `KEY_B64` argument (`Expected 1 arguments, but got 2`), and the `requireCredentials` decrypt case fails (current impl returns the raw blob string, not the parsed SA — `resolves.toEqual(SERVICE_ACCOUNT)` fails).

- [ ] **Step 3: Implement the decrypt seam in `store-client.google-api.ts`.**
  Replace the entire file with the block below. Changes vs. today: import `decryptStoreCredentials`; broaden the `GoogleCredentialsUnavailableError` message to cover the three reasons (null / no key / undecryptable); export a `GoogleServiceAccount` interface; the constructor gains an optional `encKey`; `requireCredentials` decrypts + `JSON.parse`s and returns the SA, throwing `GoogleCredentialsUnavailableError` only on null-cred, missing-key, or decrypt/parse failure; the three public methods are unchanged (they call `requireCredentials` then still throw — network stays gated).

  ```ts
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
  ```

- [ ] **Step 4: Wire the enc key through the factory.**
  Replace the entire contents of `backend/mobile_purchase/src/webhooks/google/google-store-client.factory.ts`:

  ```ts
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
  ```

- [ ] **Step 5: Inject `APP_CONFIG` into the `GOOGLE_STORE_CLIENT` provider.**
  In `backend/mobile_purchase/src/webhooks/webhooks.module.ts`, update the `GOOGLE_STORE_CLIENT` provider to also inject `APP_CONFIG` (already imported at the top of the file as `APP_CONFIG, type AppConfig`) and pass the enc key. Replace this exact block:

  ```ts
      {
        provide: GOOGLE_STORE_CLIENT,
        inject: [PrismaService],
        useFactory: (prisma: PrismaService) => buildGoogleStoreClient(prisma),
      },
  ```

  with:

  ```ts
      {
        provide: GOOGLE_STORE_CLIENT,
        inject: [PrismaService, APP_CONFIG],
        useFactory: (prisma: PrismaService, config: AppConfig) =>
          buildGoogleStoreClient(prisma, config.storeCredentialsEncKey),
      },
  ```

- [ ] **Step 6: Re-run the spec — expect pass.**
  From `backend/mobile_purchase`:
  ```bash
  npx jest src/webhooks/google/store-client.google-api.spec.ts
  ```
  Expected: all cases pass (8 tests) — null-cred / no-key / undecryptable throw; the valid cred + key case `resolves.toEqual(SERVICE_ACCOUNT)`; both public methods still throw with a valid cred + key.

- [ ] **Step 7: Type-check the whole service (the factory + module signature change compiles).**
  From `backend/mobile_purchase`:
  ```bash
  npx tsc --noEmit
  ```
  Expected: exit 0 (no type errors — `WebhooksModule` still resolves `GOOGLE_STORE_CLIENT`, existing `GOOGLE_STORE_CLIENT` consumers depend on the `StoreClient` interface only).

- [ ] **Step 8: Commit (only the four E5 files — never `git add -A`; the tree carries untouchable user WIP).**
  From the repo root:
  ```bash
  git add \
    backend/mobile_purchase/src/webhooks/google/store-client.google-api.ts \
    backend/mobile_purchase/src/webhooks/google/store-client.google-api.spec.ts \
    backend/mobile_purchase/src/webhooks/google/google-store-client.factory.ts \
    backend/mobile_purchase/src/webhooks/webhooks.module.ts
  git commit -m "feat(mobile_purchase): decrypt stored store-credentials in GoogleApiStoreClient.requireCredentials (E5)"
  ```
  (No co-author trailer. Network call stays gated — this commit only makes the stored credential reachable.)

---

### Task 6 (E6): Dashboard `store-credentials-api.ts` hooks + MSW tests

**Files:**
- Create: `dashboard/src/features/revenuecat/store-credentials-api.ts`
- Create (Test): `dashboard/src/features/revenuecat/store-credentials-api.test.ts`
- Modify: `dashboard/src/features/revenuecat/catalog-api.ts` (add the derived `storeConnected` field to the `RcApp` interface — E4 returns it on the apps list; the per-app connection list reads it so the list needs one query)

**Interfaces:**

Consumes (existing, verified):
- `purchaseApiFetch<T>(path: string, options?: { body?: unknown; method?: string; headers?: Record<string,string> }): Promise<T>` from `../../lib/api/purchase-client` — bearer JWT + RFC-7807 → `ApiError`; `204` → `undefined`; `PUT`/`DELETE` via `options.method`, JSON body via `options.body`.
- `ApiError` (`{ problem: ApiProblem }`, `problem.errors?: Record<string,string[]>`) from `../../lib/api/problem`.
- `RcAppPlatform = 'IOS' | 'ANDROID' | 'MACOS' | 'AMAZON' | 'WEB'` and `rcCatalogKey(projectId, 'apps')` (= `['rc-catalog', projectId, 'apps']`) from `./catalog-api`.
- MSW test harness: `server` (`../../test/msw/server`), `TEST_PROJECT`/`TEST_USER`/`VALID_ACCESS_TOKEN` (`../../test/msw/handlers`), `authStore` (`../auth/store`). `purchaseApiBaseUrl` resolves to `http://localhost:3000` under vitest (same as `customers-api.test.ts`).
- E4 backend endpoints (this task's server counterpart): `PUT /api/v1/projects/:projectId/catalog/apps/:appId/store-credentials` (200 status), `GET …/store-credentials/status` (200), `DELETE …/store-credentials` (204); apps list gains `storeConnected: boolean`.

Produces (E7 consumes exactly these):
- `interface StoreCredentialStatusDto { connected: boolean; platform: RcAppPlatform; liveVerified: boolean; verifiedAt: string | null }`
- `interface GooglePlayCredentialInput { kind: 'google_play'; serviceAccountJson: string }`
- `interface AppStoreCredentialInput { kind: 'app_store'; ascIssuerId: string; ascKeyId: string; ascPrivateKeyP8: string; appAppleId: string }`
- `type StoreCredentialInput = GooglePlayCredentialInput | AppStoreCredentialInput`
- `storeCredentialStatusKey(projectId: string, appId: string): readonly ['rc-store-credentials', string, string, 'status']`
- `useStoreCredentialStatus(projectId, appId): UseQueryResult<StoreCredentialStatusDto, ApiError>`
- `useSetStoreCredentials(projectId, appId): UseMutationResult<StoreCredentialStatusDto, ApiError, StoreCredentialInput>`
- `useDisconnectStoreCredentials(projectId, appId): UseMutationResult<void, ApiError, void>`
- `RcApp.storeConnected?: boolean` (added to the existing `catalog-api.ts` interface)

---

**Design decision (contract: "decide + state"):** ship BOTH status sources. The apps list's `storeConnected` boolean is the primary per-row status source (one query for the whole list, no extra fetch — E4 derives it), and `useStoreCredentialStatus` is a per-app GET that additionally exposes `liveVerified` + `verifiedAt` for the "Connected · live-verify pending" distinction and the Manage view. Both `useSetStoreCredentials` and `useDisconnectStoreCredentials` invalidate the apps-list query (`rcCatalogKey(projectId,'apps')`) AND the per-app status query on success, so whichever the row is reading refetches. Mutation shape mirrors `customers-api.ts`' `useRefundSubscription` (`useMutation<TData, ApiError, TVars>`).

---

- [ ] **Step 1: Write the failing MSW test file (full).** Create `dashboard/src/features/revenuecat/store-credentials-api.test.ts`:

```ts
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/problem';
import { server } from '../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
import { authStore } from '../auth/store';
import { useRcApps, type RcApp } from './catalog-api';
import {
  storeCredentialStatusKey,
  useDisconnectStoreCredentials,
  useSetStoreCredentials,
  useStoreCredentialStatus,
  type GooglePlayCredentialInput,
  type StoreCredentialStatusDto,
} from './store-credentials-api';

const PID = TEST_PROJECT.id;
const APP_ID = 'app-1';
const APPS = `/api/v1/projects/${PID}/catalog/apps`;
const BASE = `${APPS}/${APP_ID}/store-credentials`;

const APP: RcApp = {
  id: APP_ID,
  name: 'Demo Android',
  platform: 'ANDROID',
  bundleId: null,
  packageName: 'com.demo.app',
  publicSdkKey: 'mp_pub_abc123',
  storeConnected: false,
};

const STATUS: StoreCredentialStatusDto = {
  connected: true,
  platform: 'ANDROID',
  liveVerified: false,
  verifiedAt: null,
};

const GOOGLE_INPUT: GooglePlayCredentialInput = {
  kind: 'google_play',
  serviceAccountJson: '{"type":"service_account","client_email":"x@y.iam","private_key":"k","project_id":"p"}',
};

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('storeCredentialStatusKey', () => {
  it('is keyed by project, appId and the status tag', () => {
    expect(storeCredentialStatusKey(PID, APP_ID)).toEqual([
      'rc-store-credentials',
      PID,
      APP_ID,
      'status',
    ]);
  });
});

describe('useStoreCredentialStatus', () => {
  it('GETs the per-app status path and returns the parsed status', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.get(`${BASE}/status`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json(STATUS);
      }),
    );

    const { result } = renderHook(() => useStoreCredentialStatus(PID, APP_ID), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}/status`);
    expect(result.current.data).toEqual(STATUS);
  });
});

describe('useSetStoreCredentials', () => {
  it('PUTs the blob to the store-credentials path and invalidates the apps list + status query', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenMethod = '';
    let seenBody: unknown;
    let appsCalls = 0;
    let statusCalls = 0;
    server.use(
      http.get(APPS, () => {
        appsCalls += 1;
        return HttpResponse.json([APP]);
      }),
      http.get(`${BASE}/status`, () => {
        statusCalls += 1;
        return HttpResponse.json(STATUS);
      }),
      http.put(BASE, async ({ request }) => {
        seenUrl = request.url;
        seenMethod = request.method;
        seenBody = await request.json();
        return HttpResponse.json(STATUS);
      }),
    );

    const Wrapper = wrapper();
    const apps = renderHook(() => useRcApps(PID), { wrapper: Wrapper });
    const status = renderHook(() => useStoreCredentialStatus(PID, APP_ID), { wrapper: Wrapper });
    await waitFor(() => expect(apps.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
    expect(appsCalls).toBe(1);
    expect(statusCalls).toBe(1);

    const set = renderHook(() => useSetStoreCredentials(PID, APP_ID), { wrapper: Wrapper });
    act(() => {
      set.result.current.mutate(GOOGLE_INPUT);
    });

    await waitFor(() => expect(set.result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}`);
    expect(seenMethod).toBe('PUT');
    expect(seenBody).toEqual(GOOGLE_INPUT);
    expect(set.result.current.data).toEqual(STATUS);
    await waitFor(() => expect(appsCalls).toBe(2));
    await waitFor(() => expect(statusCalls).toBe(2));
  });

  it('surfaces a 422 problem body as ApiError with field errors and does not invalidate the status query', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let statusCalls = 0;
    server.use(
      http.get(`${BASE}/status`, () => {
        statusCalls += 1;
        return HttpResponse.json(STATUS);
      }),
      http.put(BASE, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Validation failed',
            status: 422,
            errors: { serviceAccountJson: ['must be valid service-account JSON'] },
          },
          { status: 422 },
        ),
      ),
    );

    const Wrapper = wrapper();
    const status = renderHook(() => useStoreCredentialStatus(PID, APP_ID), { wrapper: Wrapper });
    await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
    expect(statusCalls).toBe(1);

    const set = renderHook(() => useSetStoreCredentials(PID, APP_ID), { wrapper: Wrapper });
    act(() => {
      set.result.current.mutate({ kind: 'google_play', serviceAccountJson: 'not-json' });
    });

    await waitFor(() => expect(set.result.current.isError).toBe(true));
    const error = set.result.current.error;
    expect(error).toBeInstanceOf(ApiError);
    expect(error?.problem).toMatchObject({
      status: 422,
      errors: { serviceAccountJson: ['must be valid service-account JSON'] },
    });
    expect(statusCalls).toBe(1);
  });
});

describe('useDisconnectStoreCredentials', () => {
  it('DELETEs the store-credentials path and invalidates the apps list + status query', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    let seenMethod = '';
    let appsCalls = 0;
    let statusCalls = 0;
    server.use(
      http.get(APPS, () => {
        appsCalls += 1;
        return HttpResponse.json([APP]);
      }),
      http.get(`${BASE}/status`, () => {
        statusCalls += 1;
        return HttpResponse.json(STATUS);
      }),
      http.delete(BASE, ({ request }) => {
        seenUrl = request.url;
        seenMethod = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const Wrapper = wrapper();
    const apps = renderHook(() => useRcApps(PID), { wrapper: Wrapper });
    const status = renderHook(() => useStoreCredentialStatus(PID, APP_ID), { wrapper: Wrapper });
    await waitFor(() => expect(apps.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
    expect(appsCalls).toBe(1);
    expect(statusCalls).toBe(1);

    const disconnect = renderHook(() => useDisconnectStoreCredentials(PID, APP_ID), {
      wrapper: Wrapper,
    });
    act(() => {
      disconnect.result.current.mutate();
    });

    await waitFor(() => expect(disconnect.result.current.isSuccess).toBe(true));
    expect(seenUrl).toBe(`http://localhost:3000${BASE}`);
    expect(seenMethod).toBe('DELETE');
    await waitFor(() => expect(appsCalls).toBe(2));
    await waitFor(() => expect(statusCalls).toBe(2));
  });
});
```

- [ ] **Step 2: Run the test — expect RED (module + field not found).**

```bash
(cd dashboard && npx vitest run src/features/revenuecat/store-credentials-api.test.ts)
```

Expected failure: transform/resolve error `Failed to resolve import "./store-credentials-api"` (the module does not exist yet), and a tsc-level unknown-property error `Object literal may only specify known properties, and 'storeConnected' does not exist in type 'RcApp'` on the `APP` literal. All specs fail to run.

- [ ] **Step 3: Add `storeConnected` to the `RcApp` interface (minimal modify).** In `dashboard/src/features/revenuecat/catalog-api.ts`, the `RcApp` interface currently reads:

```ts
export interface RcApp {
  id: string;
  name: string;
  platform: RcAppPlatform;
  bundleId?: string | null;
  packageName?: string | null;
  publicSdkKey: string;
}
```

Replace it with (add the last field only — optional so E4's additive rollout and the existing `catalog-api.test.ts` `APP` literal without the field both still compile):

```ts
export interface RcApp {
  id: string;
  name: string;
  platform: RcAppPlatform;
  bundleId?: string | null;
  packageName?: string | null;
  publicSdkKey: string;
  /** Derived on the apps-list response (E4): `storeCredentials !== null`. Never the blob itself.
   *  The per-app connection list reads this so the whole list needs one query. */
  storeConnected?: boolean;
}
```

- [ ] **Step 4: Create the hooks module (full).** Create `dashboard/src/features/revenuecat/store-credentials-api.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiError } from '../../lib/api/problem';
import { purchaseApiFetch } from '../../lib/api/purchase-client';
import { rcCatalogKey, type RcAppPlatform } from './catalog-api';

/**
 * TanStack Query hooks over the `mobile_purchase` per-app store-credential endpoints (connect-stores
 * design `2026-07-25-connect-stores-design.md` §1.4/§2) — set / status / disconnect the Google Play
 * service account or Apple App Store Connect key that the self-hosted clone uses to talk to the
 * stores directly. Every call goes through {@link purchaseApiFetch} (bearer JWT + RFC-7807 →
 * `ApiError`), mirroring `catalog-api.ts` / `customers-api.ts`. The secret is NEVER returned — reads
 * are status-only.
 *
 * Status has two sources: the apps-list `storeConnected` boolean (primary, one query per list — see
 * `RcApp`) and this module's per-app `useStoreCredentialStatus` GET, which additionally exposes
 * `liveVerified` + `verifiedAt` for the "Connected · live-verify pending" state and the Manage view.
 * Both mutations invalidate the apps-list query AND the per-app status query on success so whichever
 * the row is reading refetches to the new state.
 */

// --- Status DTO (§1.4: GET status — derived without decrypting; `verifiedAt` is an ISO string
// on the wire) ---

export interface StoreCredentialStatusDto {
  connected: boolean;
  platform: RcAppPlatform;
  liveVerified: boolean;
  verifiedAt: string | null;
}

// --- Blob input types (§1.2: discriminated by the App's platform; ANDROID → google_play,
// IOS → app_store) ---

export interface GooglePlayCredentialInput {
  kind: 'google_play';
  serviceAccountJson: string;
}

export interface AppStoreCredentialInput {
  kind: 'app_store';
  ascIssuerId: string;
  ascKeyId: string;
  ascPrivateKeyP8: string;
  appAppleId: string;
}

export type StoreCredentialInput = GooglePlayCredentialInput | AppStoreCredentialInput;

// --- Query key & base URL ---

const storeCredentialsBase = (projectId: string, appId: string) =>
  `/api/v1/projects/${projectId}/catalog/apps/${appId}/store-credentials`;

/** `['rc-store-credentials', projectId, appId, 'status']` — the per-app status GET; both mutations
 *  invalidate this alongside the apps list. */
export function storeCredentialStatusKey(projectId: string, appId: string) {
  return ['rc-store-credentials', projectId, appId, 'status'] as const;
}

/** Invalidate BOTH status sources: the apps-list `storeConnected` field and the per-app status GET. */
function invalidateStatus(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  appId: string,
) {
  void queryClient.invalidateQueries({ queryKey: rcCatalogKey(projectId, 'apps') });
  void queryClient.invalidateQueries({ queryKey: storeCredentialStatusKey(projectId, appId) });
}

// --- Hooks ---

/** `GET …/apps/:appId/store-credentials/status` (§1.4, viewer) — non-secret status, no decrypt. */
export function useStoreCredentialStatus(projectId: string, appId: string) {
  return useQuery({
    queryKey: storeCredentialStatusKey(projectId, appId),
    queryFn: () =>
      purchaseApiFetch<StoreCredentialStatusDto>(`${storeCredentialsBase(projectId, appId)}/status`),
  });
}

/** `PUT …/apps/:appId/store-credentials` (§1.4, admin) — structural-validate → encrypt → store,
 *  returns the new status (never the secret). 422 structural / 409 platform-mismatch / 503 no-enc-key
 *  / 502 store-rejection all surface as `ApiError`. */
export function useSetStoreCredentials(projectId: string, appId: string) {
  const queryClient = useQueryClient();
  return useMutation<StoreCredentialStatusDto, ApiError, StoreCredentialInput>({
    mutationFn: (input: StoreCredentialInput) =>
      purchaseApiFetch<StoreCredentialStatusDto>(storeCredentialsBase(projectId, appId), {
        method: 'PUT',
        body: input,
      }),
    onSuccess: () => invalidateStatus(queryClient, projectId, appId),
  });
}

/** `DELETE …/apps/:appId/store-credentials` (§1.4, admin, 204) — clears the credential; idempotent. */
export function useDisconnectStoreCredentials(projectId: string, appId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () =>
      purchaseApiFetch<void>(storeCredentialsBase(projectId, appId), { method: 'DELETE' }),
    onSuccess: () => invalidateStatus(queryClient, projectId, appId),
  });
}
```

- [ ] **Step 5: Run the test — expect GREEN.**

```bash
(cd dashboard && npx vitest run src/features/revenuecat/store-credentials-api.test.ts)
```

Expected: `Test Files  1 passed (1)`, `Tests  5 passed (5)` (`storeCredentialStatusKey` keyed; `useStoreCredentialStatus` GET + parse; `useSetStoreCredentials` PUT URL/method/body/invalidation; 422 → `ApiError` with field errors + no status refetch; `useDisconnectStoreCredentials` DELETE + invalidation).

- [ ] **Step 6: Guard against regressing the sibling catalog test (the `RcApp` change).**

```bash
(cd dashboard && npx vitest run src/features/revenuecat/catalog-api.test.ts)
```

Expected: still green (`storeConnected` is optional, so the existing `APP` literal without it compiles unchanged).

- [ ] **Step 7: Commit only the three task files (never `git add -A` — the tree carries the user's collapse-rail WIP).**

```bash
git add dashboard/src/features/revenuecat/store-credentials-api.ts \
        dashboard/src/features/revenuecat/store-credentials-api.test.ts \
        dashboard/src/features/revenuecat/catalog-api.ts
git commit -m "feat(dashboard): add store-credentials-api hooks + MSW tests"
```

(No co-author trailer. `git status` before committing to confirm no WIP file — `components/layout/*`, `nav-model.ts`, `CommandPalette.tsx`, `render-app.tsx`, `RailInitial.tsx`, `demo_config.dart` — is staged.)

---

### Task 7 (E7): `RcSettingsPage` per-app store-connection list + Connect/Manage/Disconnect dialogs (Google + Apple)

**Files:**
- **Test (create):** `dashboard/src/features/revenuecat/components/rc-settings.test.tsx`
- **Modify:** `dashboard/src/features/revenuecat/components/rc-pages.test.tsx` (delete the now-obsolete `describe('RcSettingsPage', …)` block that asserts the removed `rc-integration-card`; drop the now-unused `delay` msw import)
- **Modify:** `dashboard/src/features/revenuecat/catalog-api.ts` (extend `RcApp` with the two apps-list status fields E4 adds — additive, optional)
- **Create:** `dashboard/src/features/revenuecat/components/RcSettingsPage.dialogs.tsx` (Google + Apple Connect dialogs, Disconnect alert, native controls, mounted-per-target — copies `RcCustomerDetailPage.dialogs.tsx`'s pattern)
- **Modify:** `dashboard/src/features/revenuecat/components/RcSettingsPage.tsx` (per-app list + status + admin actions; **stops rendering** `IntegrationsSection` — do NOT delete `IntegrationsSection.tsx`)

**HARD constraints obeyed:** does NOT touch `dashboard/src/components/layout/*`, `nav-model.ts`, `CommandPalette.tsx`, `render-app.tsx`, `RailInitial.tsx`, `demo_config.dart`. The nav label "Integration settings" in `nav-model.ts` stays untouched, so the page **keeps** `title="Integration settings"` (nav ↔ page stay consistent; only the page body changes). `IntegrationsSection.tsx` is untouched (still used by `ProjectDetailPage`/`RcConnectPage`).

**Interfaces:**

*Consumes — from E6 `dashboard/src/features/revenuecat/store-credentials-api.ts` (built before E7 per build order §5). E7 pins these exact names/signatures; E6 must export them:*
```ts
export interface StoreCredentialStatusDto {
  connected: boolean;
  platform: RcAppPlatform;      // 'IOS' | 'ANDROID' | 'MACOS' | 'AMAZON' | 'WEB'
  liveVerified: boolean;
  verifiedAt: string | null;
}
export interface GooglePlayCredentialInput { kind: 'google_play'; serviceAccountJson: string }
export interface AppStoreCredentialInput {
  kind: 'app_store';
  ascIssuerId: string; ascKeyId: string; ascPrivateKeyP8: string; appAppleId: string;
}
export type StoreCredentialBlobInput = GooglePlayCredentialInput | AppStoreCredentialInput;
// useMutation<StoreCredentialStatusDto, ApiError, StoreCredentialBlobInput>; PUT via purchaseApiFetch;
// invalidates the rc-catalog apps query on success.
export function useSetStoreCredentials(projectId: string, appId: string): UseMutationResult<StoreCredentialStatusDto, ApiError, StoreCredentialBlobInput>;
// useMutation<void, ApiError, void>; DELETE; invalidates the rc-catalog apps query on success.
export function useDisconnectStoreCredentials(projectId: string, appId: string): UseMutationResult<void, ApiError, void>;
```

*Consumes — existing code (verified):*
- `useRcApps(projectId)` → `useQuery<RcApp[]>` (`catalog-api.ts:174`), query key `['rc-catalog', projectId, 'apps']`.
- `useProjects()` / `useProjectRole(projectId)` (`features/projects/api.ts:33,41`) — role `'owner' | 'admin' | 'member' | 'viewer' | undefined`.
- `PageShell` (`components/layout/PageShell.tsx`), `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent` (`components/ui/card.tsx`), `Badge` (`components/ui/badge.tsx`, variants `default|success|warning|outline`), `Button` (`components/ui/button.tsx`, `buttonVariants`, variants `primary|secondary|danger`, sizes `sm|md`), `EmptyState` (`components/ui/empty-state.tsx`), `Dialog`/`DialogContent`/`DialogTitle`/`DialogDescription` (`components/ui/dialog.tsx`), `AlertDialog…` (`components/ui/alert-dialog.tsx`), `Input`/`fieldLook` (`components/ui/input.tsx`), `Textarea` (`components/ui/textarea.tsx`), `Label` (`components/ui/label.tsx`), `useToast` (`components/ui/toast.tsx`, `toast({ title, variant })`), `ApiError` (`lib/api/problem.ts`, `.problem.status/detail/title/errors`).
- Route id `'/private/projects/$projectId/rc/settings'` (`router.tsx:351`); Products route `'/projects/$projectId/rc/products'` (`router.tsx:322`).

*Produces — for later tasks / the gate:*
- `RcApp` gains `storeConnected?: boolean` and `storeCredentialsLiveVerified?: boolean`.
- `RcSettingsPage.dialogs.tsx` exports `GooglePlayConnectDialog`, `AppStoreConnectDialog`, `DisconnectStoreAlertDialog`, `apiErrorMessage`.
- `RcSettingsPage` renders no `IntegrationsSection` (no `rc-integration-card` testid on this route).

---

#### TDD cycle — one failing test file, then implement

- [ ] **Step 1: Write the full MSW page test `rc-settings.test.tsx` (RED).** Create `dashboard/src/features/revenuecat/components/rc-settings.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

const PID = TEST_PROJECT.id;
const SETTINGS_URL = `/projects/${PID}/rc/settings`;
const catalogBase = `/api/v1/projects/${PID}/catalog`;

function problem(status: number, title: string, extra: Record<string, unknown> = {}) {
  return HttpResponse.json(
    { type: 'about:blank', title, status, ...extra },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

interface FixtureApp {
  id: string;
  name: string;
  platform: string;
  bundleId: string | null;
  packageName: string | null;
  publicSdkKey: string;
  storeConnected: boolean;
  storeCredentialsLiveVerified: boolean;
}

const IOS_APP: FixtureApp = {
  id: 'app-ios',
  name: 'Aurora iOS',
  platform: 'IOS',
  bundleId: 'com.example.aurora',
  packageName: null,
  publicSdkKey: 'mp_pub_ios',
  storeConnected: false,
  storeCredentialsLiveVerified: false,
};

const ANDROID_APP: FixtureApp = {
  id: 'app-android',
  name: 'Aurora Android',
  platform: 'ANDROID',
  bundleId: null,
  packageName: 'com.example.aurora',
  publicSdkKey: 'mp_pub_android',
  storeConnected: false,
  storeCredentialsLiveVerified: false,
};

/**
 * Stateful in-memory mock of the apps list + PUT/DELETE store-credentials endpoints for one test —
 * mirrors `rc-customer-detail.test.tsx`'s `mockCustomerDetail`. The default PUT marks the app
 * connected + live-verified (returns `liveVerified: true`); tests needing the pending / 422 / 503
 * branches register a later `http.put` override (later `server.use` wins). GET reads the current
 * state so a connect/disconnect is visible on the apps-list refetch the E6 hooks trigger.
 */
function mockStoreCredentials(seed: FixtureApp[]) {
  const apps = seed.map((app) => ({ ...app }));

  server.use(
    http.get(`${catalogBase}/apps`, () => HttpResponse.json(apps)),
    http.put(`${catalogBase}/apps/:appId/store-credentials`, ({ params }) => {
      const app = apps.find((candidate) => candidate.id === params.appId);
      if (!app) return problem(404, 'App not found');
      app.storeConnected = true;
      app.storeCredentialsLiveVerified = true;
      return HttpResponse.json({
        connected: true,
        platform: app.platform,
        liveVerified: true,
        verifiedAt: '2026-07-25T00:00:00.000Z',
      });
    }),
    http.delete(`${catalogBase}/apps/:appId/store-credentials`, ({ params }) => {
      const app = apps.find((candidate) => candidate.id === params.appId);
      if (app) {
        app.storeConnected = false;
        app.storeCredentialsLiveVerified = false;
      }
      return new HttpResponse(null, { status: 204 });
    }),
  );

  return apps;
}

function signInOwner() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

function signInViewer() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
  server.use(
    http.get('/api/v1/projects', () =>
      HttpResponse.json({ projects: [{ ...TEST_PROJECT, role: 'viewer' }] }),
    ),
  );
}

/** Scope assertions to one app's row (the list is a `<ul>`, not a table, so there's no `<tr>`). */
function row(appId: string): HTMLElement {
  const rowEl = document.querySelector(`[data-app-row="${appId}"]`);
  if (!rowEl) throw new Error(`row for ${appId} not found`);
  return rowEl as HTMLElement;
}

describe('RcSettingsPage — store connections', () => {
  it('renders each app with its platform and store-connection status', async () => {
    signInOwner();
    mockStoreCredentials([
      { ...IOS_APP, storeConnected: true, storeCredentialsLiveVerified: true },
      { ...ANDROID_APP },
    ]);
    renderApp(SETTINGS_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('heading', { name: 'Integration settings' })).toBeInTheDocument();
    await main.findByText('Aurora iOS');

    const iosRow = within(row(IOS_APP.id));
    expect(iosRow.getByText('iOS')).toBeInTheDocument();
    expect(iosRow.getByText('Connected')).toBeInTheDocument();

    const androidRow = within(row(ANDROID_APP.id));
    expect(androidRow.getByText('Android')).toBeInTheDocument();
    expect(androidRow.getByText('Not connected')).toBeInTheDocument();
    expect(androidRow.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('renders the live-verify pending status for a connected-but-unverified app', async () => {
    signInOwner();
    mockStoreCredentials([{ ...ANDROID_APP, storeConnected: true, storeCredentialsLiveVerified: false }]);
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora Android');

    const androidRow = within(row(ANDROID_APP.id));
    expect(androidRow.getByText('Connected · live-verify pending')).toBeInTheDocument();
    expect(androidRow.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
    expect(androidRow.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('no longer renders the legacy RevenueCat integration card', async () => {
    signInOwner();
    mockStoreCredentials([{ ...IOS_APP }]);
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora iOS');
    expect(screen.queryByTestId('rc-integration-card')).not.toBeInTheDocument();
  });

  it('shows an empty state linking to Products when the project has no apps', async () => {
    signInOwner();
    mockStoreCredentials([]);
    renderApp(SETTINGS_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('No apps yet')).toBeInTheDocument();
    const link = main.getByRole('link', { name: 'Go to Products' });
    expect(link).toHaveAttribute('href', `/projects/${PID}/rc/products`);
  });

  it('connects Google Play: paste JSON, submit, success toast, row becomes Connected', async () => {
    signInOwner();
    mockStoreCredentials([{ ...ANDROID_APP }]);
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora Android');

    await userEvent.click(within(row(ANDROID_APP.id)).getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Connect Google Play')).toBeInTheDocument();
    await userEvent.type(dialog.getByLabelText('Service account JSON'), 'service-account-json-here');
    await userEvent.click(dialog.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Store connected')).toBeInTheDocument();
    await waitFor(() => expect(within(row(ANDROID_APP.id)).getByText('Connected')).toBeInTheDocument());
  });

  it('connects the App Store: pending live-verify → pending toast + pending status', async () => {
    signInOwner();
    const apps = mockStoreCredentials([{ ...IOS_APP }]);
    // Creds-gated live validation unavailable → connected but pending (design §0/§1.3).
    server.use(
      http.put(`${catalogBase}/apps/:appId/store-credentials`, ({ params }) => {
        const app = apps.find((candidate) => candidate.id === params.appId);
        if (!app) return problem(404, 'App not found');
        app.storeConnected = true;
        app.storeCredentialsLiveVerified = false;
        return HttpResponse.json({
          connected: true,
          platform: app.platform,
          liveVerified: false,
          verifiedAt: null,
        });
      }),
    );
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora iOS');

    await userEvent.click(within(row(IOS_APP.id)).getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Connect App Store')).toBeInTheDocument();
    expect(dialog.getByLabelText('Bundle ID')).toHaveValue('com.example.aurora');
    await userEvent.type(dialog.getByLabelText('Issuer ID'), '57246542-0000-1111-2222-333344445555');
    await userEvent.type(dialog.getByLabelText('Key ID'), 'ABCDE12345');
    await userEvent.type(dialog.getByLabelText('App Store Connect app ID'), '1234567890');
    await userEvent.type(dialog.getByLabelText('.p8 private key'), 'p8-key-material');
    await userEvent.click(dialog.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Connected — live verification pending')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(row(IOS_APP.id)).getByText('Connected · live-verify pending')).toBeInTheDocument(),
    );
  });

  it('shows structural 422 field errors inline and keeps the dialog open', async () => {
    signInOwner();
    mockStoreCredentials([{ ...ANDROID_APP }]);
    server.use(
      http.put(`${catalogBase}/apps/:appId/store-credentials`, () =>
        problem(422, 'Validation failed', {
          errors: { serviceAccountJson: ['serviceAccountJson is not valid service-account JSON'] },
        }),
      ),
    );
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora Android');

    await userEvent.click(within(row(ANDROID_APP.id)).getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Service account JSON'), 'not json');
    await userEvent.click(dialog.getByRole('button', { name: 'Connect' }));

    expect(
      await dialog.findByText('serviceAccountJson is not valid service-account JSON'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(row(ANDROID_APP.id)).getByText('Not connected')).toBeInTheDocument();
  });

  it('shows the enc-key hint on a 503 and keeps the dialog open', async () => {
    signInOwner();
    mockStoreCredentials([{ ...ANDROID_APP }]);
    server.use(
      http.put(`${catalogBase}/apps/:appId/store-credentials`, () =>
        problem(503, 'Store credentials encryption key not configured'),
      ),
    );
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora Android');

    await userEvent.click(within(row(ANDROID_APP.id)).getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Service account JSON'), 'json');
    await userEvent.click(dialog.getByRole('button', { name: 'Connect' }));

    expect(
      await dialog.findByText('Set STORE_CREDENTIALS_ENC_KEY on the server first.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders read-only for a viewer: status visible, no connect/manage/disconnect controls', async () => {
    signInViewer();
    mockStoreCredentials([{ ...IOS_APP, storeConnected: true, storeCredentialsLiveVerified: true }]);
    renderApp(SETTINGS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('Aurora iOS');

    expect(within(row(IOS_APP.id)).getByText('Connected')).toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });

  it('disconnects a connected app after confirming: DELETE, toast, row becomes Not connected', async () => {
    signInOwner();
    mockStoreCredentials([{ ...IOS_APP, storeConnected: true, storeCredentialsLiveVerified: true }]);
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora iOS');

    await userEvent.click(within(row(IOS_APP.id)).getByRole('button', { name: 'Disconnect' }));
    const alert = within(await screen.findByRole('alertdialog'));
    expect(alert.getByText('Disconnect Aurora iOS?')).toBeInTheDocument();
    await userEvent.click(alert.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Store disconnected')).toBeInTheDocument();
    await waitFor(() => expect(within(row(IOS_APP.id)).getByText('Not connected')).toBeInTheDocument());
  });
});
```

Run (expected **RED** — `store-credentials-api` import + new dialogs don't exist yet, page still renders `IntegrationsSection`):
```
npx vitest run src/features/revenuecat/components/rc-settings.test.tsx
```

- [ ] **Step 2: Extend `RcApp` with the apps-list status fields.** In `dashboard/src/features/revenuecat/catalog-api.ts`, replace the `RcApp` interface (currently `catalog-api.ts:19-26`):

```ts
export interface RcApp {
  id: string;
  name: string;
  platform: RcAppPlatform;
  bundleId?: string | null;
  packageName?: string | null;
  publicSdkKey: string;
  /** Store-credential connection status surfaced on the apps list (E4 backend): `storeConnected` is
   *  derived (`storeCredentials !== null`); `storeCredentialsLiveVerified` reflects the App column
   *  added in E3. Both optional so pre-E4 callers/tests still typecheck; absent → treated as false. */
  storeConnected?: boolean;
  storeCredentialsLiveVerified?: boolean;
}
```
(The `omit: { storeCredentials: true }` in `apps.service.ts` still keeps the encrypted blob out of the response — E4 selects only the two booleans.)

- [ ] **Step 3: Create the dialogs file `RcSettingsPage.dialogs.tsx`.** Create `dashboard/src/features/revenuecat/components/RcSettingsPage.dialogs.tsx` (native controls only — Radix Select hangs jsdom, so all pickers are plain elements; mounted-per-target like `RcCustomerDetailPage.dialogs.tsx`):

```tsx
import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import type { RcApp } from '../catalog-api';
import { useDisconnectStoreCredentials, useSetStoreCredentials } from '../store-credentials-api';

/** Renders an `ApiError`'s detail/title inline; any non-API error falls back. Mirrors the helper of
 *  the same name in `RcCustomerDetailPage.dialogs.tsx`. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

interface DialogError {
  general?: string;
  fields?: Record<string, string[]>;
}

/** Maps a failed `useSetStoreCredentials` mutation to inline dialog state (design §2/§3): 503 → the
 *  enc-key hint, 422 → per-field errors (+ any `detail`), anything else → one general message. */
function toDialogError(error: unknown): DialogError {
  if (error instanceof ApiError) {
    if (error.problem.status === 503) {
      return { general: 'Set STORE_CREDENTIALS_ENC_KEY on the server first.' };
    }
    if (error.problem.errors) {
      return { fields: error.problem.errors, general: error.problem.detail };
    }
    return { general: error.problem.detail ?? error.problem.title };
  }
  return { general: 'Could not connect the store.' };
}

function FieldErrors({ error, field }: { error: DialogError | null; field: string }) {
  const messages = error?.fields?.[field];
  if (!messages || messages.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {messages.map((message) => (
        <li key={message} role="alert" className="text-sm text-danger">
          {message}
        </li>
      ))}
    </ul>
  );
}

/** File-upload convenience: the native `<input type="file">` fills the paste field so the two entry
 *  paths converge on one controlled value. `File.text()` is available in jsdom. */
async function readFileText(event: ChangeEvent<HTMLInputElement>): Promise<string | null> {
  const file = event.target.files?.[0];
  return file ? file.text() : null;
}

export function GooglePlayConnectDialog({
  projectId,
  app,
  onClose,
}: {
  projectId: string;
  app: RcApp;
  onClose: () => void;
}) {
  const setCredentials = useSetStoreCredentials(projectId, app.id);
  const { toast } = useToast();
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [error, setError] = useState<DialogError | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const text = await readFileText(event);
    if (text !== null) setServiceAccountJson(text);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setCredentials.mutate(
      { kind: 'google_play', serviceAccountJson },
      {
        onSuccess: (status) => {
          onClose();
          toast({
            title: status.liveVerified ? 'Store connected' : 'Connected — live verification pending',
          });
        },
        onError: (mutationError) => setError(toDialogError(mutationError)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Connect Google Play</DialogTitle>
        <DialogDescription>
          Paste the Google Play service-account JSON for {app.name}. It’s encrypted at rest and never
          shown again.
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="gp-json" className="mb-1 block">
              Service account JSON
            </Label>
            <Textarea
              id="gp-json"
              aria-label="Service account JSON"
              value={serviceAccountJson}
              onChange={(event) => setServiceAccountJson(event.target.value)}
            />
            <FieldErrors error={error} field="serviceAccountJson" />
          </div>
          <div>
            <Label htmlFor="gp-file" className="mb-1 block">
              …or upload the .json file
            </Label>
            <input id="gp-file" type="file" accept="application/json,.json" onChange={handleFile} />
          </div>
          {error?.general && (
            <p role="alert" className="text-sm text-danger">
              {error.general}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={setCredentials.isPending}>
              {setCredentials.isPending ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AppStoreConnectDialog({
  projectId,
  app,
  onClose,
}: {
  projectId: string;
  app: RcApp;
  onClose: () => void;
}) {
  const setCredentials = useSetStoreCredentials(projectId, app.id);
  const { toast } = useToast();
  const [ascIssuerId, setAscIssuerId] = useState('');
  const [ascKeyId, setAscKeyId] = useState('');
  const [appAppleId, setAppAppleId] = useState('');
  const [ascPrivateKeyP8, setAscPrivateKeyP8] = useState('');
  const [error, setError] = useState<DialogError | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const text = await readFileText(event);
    if (text !== null) setAscPrivateKeyP8(text);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setCredentials.mutate(
      { kind: 'app_store', ascIssuerId, ascKeyId, ascPrivateKeyP8, appAppleId },
      {
        onSuccess: (status) => {
          onClose();
          toast({
            title: status.liveVerified ? 'Store connected' : 'Connected — live verification pending',
          });
        },
        onError: (mutationError) => setError(toDialogError(mutationError)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Connect App Store</DialogTitle>
        <DialogDescription>
          Paste the App Store Connect API key and ASSN config for {app.name}. Credentials are
          encrypted at rest and never shown again.
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="asc-issuer" className="mb-1 block">
              Issuer ID
            </Label>
            <Input
              id="asc-issuer"
              aria-label="Issuer ID"
              value={ascIssuerId}
              onChange={(event) => setAscIssuerId(event.target.value)}
            />
            <FieldErrors error={error} field="ascIssuerId" />
          </div>
          <div>
            <Label htmlFor="asc-key-id" className="mb-1 block">
              Key ID
            </Label>
            <Input
              id="asc-key-id"
              aria-label="Key ID"
              value={ascKeyId}
              onChange={(event) => setAscKeyId(event.target.value)}
            />
            <FieldErrors error={error} field="ascKeyId" />
          </div>
          <div>
            <Label htmlFor="asc-app-apple-id" className="mb-1 block">
              App Store Connect app ID
            </Label>
            <Input
              id="asc-app-apple-id"
              aria-label="App Store Connect app ID"
              value={appAppleId}
              onChange={(event) => setAppAppleId(event.target.value)}
            />
            <FieldErrors error={error} field="appAppleId" />
          </div>
          <div>
            <Label htmlFor="asc-bundle-id" className="mb-1 block">
              Bundle ID
            </Label>
            <Input id="asc-bundle-id" aria-label="Bundle ID" value={app.bundleId ?? ''} readOnly disabled />
          </div>
          <div>
            <Label htmlFor="asc-p8" className="mb-1 block">
              .p8 private key
            </Label>
            <Textarea
              id="asc-p8"
              aria-label=".p8 private key"
              value={ascPrivateKeyP8}
              onChange={(event) => setAscPrivateKeyP8(event.target.value)}
            />
            <FieldErrors error={error} field="ascPrivateKeyP8" />
          </div>
          <div>
            <Label htmlFor="asc-p8-file" className="mb-1 block">
              …or upload the .p8 file
            </Label>
            <input id="asc-p8-file" type="file" accept=".p8" onChange={handleFile} />
          </div>
          {error?.general && (
            <p role="alert" className="text-sm text-danger">
              {error.general}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={setCredentials.isPending}>
              {setCredentials.isPending ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Disconnect (design §1.4): clears the stored credential. Same suppress-auto-close +
 *  `preventDefault` `AlertDialogAction` pattern as `RcCustomerDetailPage.dialogs.tsx`, but the
 *  outcome is a toast (the row refetches to Not connected off the hook's apps invalidation). */
export function DisconnectStoreAlertDialog({
  projectId,
  app,
  onClose,
}: {
  projectId: string;
  app: RcApp;
  onClose: () => void;
}) {
  const disconnect = useDisconnectStoreCredentials(projectId, app.id);
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Disconnect {app.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          The stored store credentials for this app are deleted. Store-authoritative actions (refunds,
          live checks) stop working until you reconnect. This cannot be undone.
        </AlertDialogDescription>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="danger"
              disabled={disconnect.isPending}
              onClick={(event) => {
                event.preventDefault();
                setError(null);
                disconnect.mutate(undefined, {
                  onSuccess: () => {
                    onClose();
                    toast({ title: 'Store disconnected' });
                  },
                  onError: (mutationError) =>
                    setError(apiErrorMessage(mutationError, 'Could not disconnect this store.')),
                });
              }}
            >
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: Rewrite `RcSettingsPage.tsx` — per-app list, drop `IntegrationsSection`.** Replace the entire contents of `dashboard/src/features/revenuecat/components/RcSettingsPage.tsx`:

```tsx
import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Badge } from '../../../components/ui/badge';
import { Button, buttonVariants } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { useProjectRole, useProjects } from '../../projects/api';
import { useRcApps, type RcApp, type RcAppPlatform } from '../catalog-api';
import {
  AppStoreConnectDialog,
  DisconnectStoreAlertDialog,
  GooglePlayConnectDialog,
} from './RcSettingsPage.dialogs';

const PLATFORM_LABEL: Record<RcAppPlatform, string> = {
  IOS: 'iOS',
  ANDROID: 'Android',
  MACOS: 'macOS',
  AMAZON: 'Amazon',
  WEB: 'Web',
};

/** Only iOS (App Store Connect) and Android (Google Play) have a store-credential flow — the backend
 *  maps exactly `IOS -> app_store` and `ANDROID -> google_play` (design §1.2). Other platforms show
 *  their status but expose no connect action. */
function supportsStoreCredentials(platform: RcAppPlatform): boolean {
  return platform === 'IOS' || platform === 'ANDROID';
}

type StoreStatus = 'not_connected' | 'connected' | 'pending';

/** Derived from the apps-list `storeConnected` + `storeCredentialsLiveVerified` fields (design §2). */
function storeStatus(app: RcApp): StoreStatus {
  if (!app.storeConnected) return 'not_connected';
  return app.storeCredentialsLiveVerified ? 'connected' : 'pending';
}

function StoreStatusBadge({ status }: { status: StoreStatus }) {
  if (status === 'connected') return <Badge variant="success">Connected</Badge>;
  if (status === 'pending') return <Badge variant="warning">Connected · live-verify pending</Badge>;
  return <Badge variant="default">Not connected</Badge>;
}

/**
 * MyRevenueCat → Integration settings (connect-stores design §2). Replaces the legacy real-RevenueCat
 * connect card (`IntegrationsSection`, still used by ProjectDetailPage/RcConnectPage — not deleted)
 * with a per-app store-credential list: each `App` from `useRcApps`, its platform, connection status,
 * and admin-only Connect/Manage/Disconnect. Gate is only `useProjects()` resolving (mirrors
 * `RcCustomerDetailPage`); a viewer sees status read-only. Empty state links to the Products page.
 */
export function RcSettingsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/settings' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);

  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Integration settings"
        description="Connect and manage the app stores this project talks to directly."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Integration settings' }]}
      >
        {null}
      </PageShell>
    );
  }

  return <StoreConnectionsManager projectId={projectId} />;
}

function StoreConnectionsManager({ projectId }: { projectId: string }) {
  const role = useProjectRole(projectId);
  const canManage = role === 'admin' || role === 'owner';

  const appsQuery = useRcApps(projectId);
  const apps = appsQuery.data ?? [];

  const [connectTarget, setConnectTarget] = useState<RcApp | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<RcApp | null>(null);

  return (
    <PageShell
      projectId={projectId}
      title="Integration settings"
      description="Connect and manage the app stores this project talks to directly."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Integration settings' }]}
    >
      <Card>
        <CardHeader>
          <CardTitle>Store connections</CardTitle>
          <CardDescription>
            Give each app the store credentials the clone uses to talk to Google Play and the App
            Store directly. Credentials are encrypted at rest and never shown again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {appsQuery.isError ? (
            <p role="alert" className="text-sm text-danger">
              Could not load this project’s apps.
            </p>
          ) : apps.length === 0 ? (
            <EmptyState
              title="No apps yet"
              description="Create an app before you can connect its store credentials."
              action={
                <Link
                  to="/projects/$projectId/rc/products"
                  params={{ projectId }}
                  className={buttonVariants({ size: 'sm' })}
                >
                  Go to Products
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {apps.map((app) => {
                const status = storeStatus(app);
                return (
                  <li
                    key={app.id}
                    data-app-row={app.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-text">{app.name}</span>
                      <Badge variant="outline">{PLATFORM_LABEL[app.platform]}</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <StoreStatusBadge status={status} />
                      {canManage && supportsStoreCredentials(app.platform) && (
                        <div className="flex items-center gap-2">
                          {status === 'not_connected' ? (
                            <Button size="sm" onClick={() => setConnectTarget(app)}>
                              Connect
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setConnectTarget(app)}
                              >
                                Manage
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => setDisconnectTarget(app)}
                              >
                                Disconnect
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage && connectTarget?.platform === 'ANDROID' && (
        <GooglePlayConnectDialog
          projectId={projectId}
          app={connectTarget}
          onClose={() => setConnectTarget(null)}
        />
      )}
      {canManage && connectTarget?.platform === 'IOS' && (
        <AppStoreConnectDialog
          projectId={projectId}
          app={connectTarget}
          onClose={() => setConnectTarget(null)}
        />
      )}
      {canManage && disconnectTarget && (
        <DisconnectStoreAlertDialog
          projectId={projectId}
          app={disconnectTarget}
          onClose={() => setDisconnectTarget(null)}
        />
      )}
    </PageShell>
  );
}
```

Run (expected **GREEN** — all 10 cases pass):
```
npx vitest run src/features/revenuecat/components/rc-settings.test.tsx
```

- [ ] **Step 5: Remove the stale `RcSettingsPage` coverage from `rc-pages.test.tsx`.** Both existing cases assert the removed `IntegrationsSection` (`rc-integration-card` / the "only admins" gate), which no longer exists on this route — coverage now lives in `rc-settings.test.tsx`. In `dashboard/src/features/revenuecat/components/rc-pages.test.tsx`:
  1. Delete the whole block `describe('RcSettingsPage', () => { … });` (currently lines 114-143).
  2. Change the msw import from `import { delay, http, HttpResponse } from 'msw';` to `import { http, HttpResponse } from 'msw';` (`delay` was used only by the deleted "only admins while loading" case; `http`/`HttpResponse` stay — the `RcConversionPage` failure case still uses them). Leave every other describe block untouched.

Run (expected **GREEN** — the remaining Overview/Conversion/Placeholder cases pass, no unused-import error):
```
npx vitest run src/features/revenuecat/components/rc-pages.test.tsx
```

- [ ] **Step 6: Typecheck the two touched suites' compile unit.** (`store-credentials-api.ts` from E6 must already exist.)
```
npm run typecheck
```
Expected: exits 0 (no errors). If it reports the `store-credentials-api` module missing, E6 is not yet merged — block on E6 before continuing (build order §5).

- [ ] **Step 7: Commit the E7 files only.** Stage exactly the five task files — never `git add -A` (the tree carries protected WIP: `components/layout/*`, `nav-model.ts`, `CommandPalette.tsx`, `render-app.tsx`, `RailInitial.tsx`, `demo_config.dart`). No secrets are involved (nothing is written to disk; test credential strings are inert literals). No co-author trailer.
```
git add \
  dashboard/src/features/revenuecat/components/RcSettingsPage.tsx \
  dashboard/src/features/revenuecat/components/RcSettingsPage.dialogs.tsx \
  dashboard/src/features/revenuecat/catalog-api.ts \
  dashboard/src/features/revenuecat/components/rc-settings.test.tsx \
  dashboard/src/features/revenuecat/components/rc-pages.test.tsx
git commit -m "feat(dashboard): connect-stores per-app list + Google/Apple connect dialogs on RcSettingsPage"
```

**Verification recap (design §4 dashboard row):** per-app list renders status ✓; Google connect success → Connected ✓; Apple connect → Connected · live-verify pending ✓; 422 inline ✓; 503 hint ✓; viewer read-only ✓; disconnect → Not connected ✓; legacy RevenueCat secret-API-key card (`rc-integration-card`) gone from this page ✓; empty state links to Products ✓.

---

### Task 8 (E8): Verify gate (no new code)

**Files:** Verification-only — this task writes **no** source and **no** test.
- Verify (backend, `backend/mobile_purchase/`): `src/common/crypto/store-credentials-cipher.spec.ts` (E1), `src/catalog/store-credentials/store-credential.types.spec.ts` + `src/catalog/store-credentials/store-credential-validator.spec.ts` (E2), `src/catalog/store-credentials/store-credentials.service.spec.ts` (E3, Testcontainers), `test/e2e/store-credentials.e2e-spec.ts` (E4), `src/webhooks/google/store-client.google-api.spec.ts` (E5 adds the requireCredentials-decrypt cases into this existing file).
- Verify (dashboard, `dashboard/`): `src/features/revenuecat/store-credentials-api.test.ts` (E6), `src/features/revenuecat/components/rc-settings.test.tsx` (E7).
- Append-only (do **not** git add/commit — `.superpowers` is gitignored): `.superpowers/sdd/progress.md`.

**Interfaces:** Consumes: the full E1–E7 deliverable surface (the cross-task contract) as already committed on `feat/revenuecat-integration`. Produces: nothing importable — an E-complete ledger entry in `progress.md` and a green-gate attestation. This is the last E task; no later task depends on its output.

**Baseline (from the D-era):** the last recorded full `mobile_purchase` run was 64 suites / 585 tests green (D-era). E adds five new spec files — cipher (E1), blob-types (E2), validator (E2), service (E3, Testcontainers), store-credentials e2e (E4) — plus new cases inside the existing `store-client.google-api.spec.ts` (E5). So the full-suite **count must grow** (roughly 64→~69 suites); record the exact observed numbers at gate time, never assert a pre-guessed pass count.

> Run every backend command from `backend/mobile_purchase/`, every dashboard command from `dashboard/`. `backend/mobile_purchase` has **no** `.env`; Testcontainers manage their own Postgres (Docker must be up). Single-file jest = `npx jest <path>`. Dashboard runs one vitest file at a time (`npx vitest run <file>`); if a runner hangs, `pkill -9 -f vitest` and re-run the single file.

- [ ] **Step 1: Confirm Docker is up (Testcontainers dependency).**
  Run:
  ```bash
  docker info >/dev/null 2>&1 && echo "docker: up" || echo "docker: DOWN — start Docker Desktop before Steps 5-6, 8"
  ```
  Expected output:
  ```
  docker: up
  ```
  Gate rule: if `DOWN`, start Docker and re-check — do not skip the Testcontainers / e2e / full-suite steps.

- [ ] **Step 2: `mobile_purchase` typecheck = 0 errors.**
  Run (from `backend/mobile_purchase/`):
  ```bash
  npm run typecheck
  ```
  (= `tsc --noEmit`, per `package.json` scripts.) Expected: exits **0**, prints nothing (no `error TS...` lines). Gate rule: any `error TS` → FAIL, stop.

- [ ] **Step 3: E1 cipher unit spec — solo, green.**
  Run:
  ```bash
  npx jest src/common/crypto/store-credentials-cipher.spec.ts
  ```
  Expected tail:
  ```
  Test Suites: 1 passed, 1 total
  Tests:       <n> passed, <n> total
  ```
  Must cover: round-trip encrypt→decrypt equality; `base64(iv).base64(tag).base64(ciphertext)` dot-shape (3 parts); wrong-key-length → `StoreCipherError`; tampered auth-tag → `StoreCipherError`; a non-32-byte `keyB64` → `StoreCipherError`. Gate rule: `0 total` (file not found / not collected) → FAIL.

- [ ] **Step 4: E2 blob-types + validator unit specs — solo, green.**
  Run each separately:
  ```bash
  npx jest src/catalog/store-credentials/store-credential.types.spec.ts
  ```
  Expected: `Test Suites: 1 passed, 1 total`; covers `parseStoreCredentialBlob` — valid Google + valid Apple; each malformed field (Google: non-JSON, `type !== "service_account"`, missing `client_email`/`private_key`/`project_id`; Apple: `ascKeyId` not 10-char, `ascIssuerId` not a UUID, `.p8` missing PEM header, `appAppleId` non-digits) → `ProblemException` **422**; `kind`-vs-platform mismatch → **409**.
  ```bash
  npx jest src/catalog/store-credentials/store-credential-validator.spec.ts
  ```
  Expected: `Test Suites: 1 passed, 1 total`; drives the `InMemoryStoreCredentialValidator` branches (`{liveVerified:true}` / `{liveVerified:false}` / throws `StoreValidationUnavailableError` / throws a generic store error) and asserts `validate()` calls are recorded; asserts the real impl throws `StoreValidationUnavailableError` today. Gate rule: either `0 total` or any red → FAIL.

- [ ] **Step 5: E3 StoreCredentialsService Testcontainers spec — solo, green (Docker up).**
  Run:
  ```bash
  npx jest src/catalog/store-credentials/store-credentials.service.spec.ts
  ```
  Expected tail:
  ```
  Test Suites: 1 passed, 1 total
  Tests:       <n> passed, <n> total
  ```
  Must cover the §1.4 matrix: happy `set` → `connected:true` (live-verified path, `verifiedAt = new Date(nowMs)`); `pending` path (`StoreValidationUnavailableError` → `liveVerified:false`, `verifiedAt:null`); platform-mismatch **409**; no-enc-key **503**; store-rejection **502** (no write); cross-project / cross-app **404** (opaque "App not found"); `status` derived without decrypt; secret **never** returned; `disconnect` nulls all three + idempotent. Gate rule: container start failure → this is the Docker prerequisite, fix Step 1 then re-run.

- [ ] **Step 6: E4 store-credentials e2e — solo, green (Docker up).**
  Run:
  ```bash
  npx jest test/e2e/store-credentials.e2e-spec.ts
  ```
  Expected: `Test Suites: 1 passed, 1 total`; covers PUT admin **200** (returns `StoreCredentialStatus`, no blob) / viewer **403** / unauth **401** / cross-scope **404** / malformed body **422**; GET status viewer **200**; DELETE admin **204**; and the apps-list `storeConnected` boolean is present WITHOUT the blob. Gate rule: any red → FAIL.

- [ ] **Step 7: E5 requireCredentials-decrypt spec — solo, green.**
  Run:
  ```bash
  npx jest src/webhooks/google/store-client.google-api.spec.ts
  ```
  Expected: `Test Suites: 1 passed, 1 total`; the E5 additions must cover: `storeCredentials` present → `decryptStoreCredentials` + `JSON.parse` → returns the Google service account; `storeCredentials` null → `GoogleCredentialsUnavailableError`; enc key missing → `GoogleCredentialsUnavailableError`; decrypt failure → `GoogleCredentialsUnavailableError`; and the `googleapis` network call in `getSubscriptionV2` / `revokeAndRefundSubscription` **still throws** (stays creds-gated — decrypt made the credential *reachable*, not the network live). Gate rule: if any test proves a live network call now succeeds → FAIL (scope violation).

- [ ] **Step 8: FULL `mobile_purchase` suite — green, count grew (Docker up).**
  Run (from `backend/mobile_purchase/`):
  ```bash
  npm test
  ```
  (= `jest`, all `src/**/*.spec.ts` + `test/e2e/**/*.e2e-spec.ts`; `SCHEDULER_ENABLED=false` is forced by `test/jest-setup-env.ts`, so no live cron mid-run.) Expected tail:
  ```
  Test Suites: <S> passed, <S> total
  Tests:       <T> passed, <T> total
  ```
  Gate rule: **0 failed**; `<S>` MUST exceed the D-era 64 (the five new E spec files) and `<T>` MUST exceed 585 (E5 cases fold into the existing google-api suite, so its suite count is unchanged but its test count rose). Record the exact `<S>/<T>` in the ledger. A benign "worker failed to exit gracefully" warning (pre-existing Testcontainers/Prisma open handle) is acceptable as long as every test passes.

- [ ] **Step 9: `dashboard` typecheck = 0 errors (user WIP still compiles).**
  Run (from `dashboard/`):
  ```bash
  npm run typecheck
  ```
  (= `tsc --noEmit`.) Expected: exits **0**, no `error TS` lines. This also proves the user's uncommitted collapse-rail WIP still compiles against the E6/E7 additions. Gate rule: any `error TS` → FAIL.

- [ ] **Step 10: E6 store-credentials-api hooks test — solo, green (vitest, one file).**
  Run (from `dashboard/`):
  ```bash
  npx vitest run src/features/revenuecat/store-credentials-api.test.ts
  ```
  Expected tail:
  ```
   Test Files  1 passed (1)
        Tests  <n> passed (<n>)
  ```
  Covers (MSW): `useSetStoreCredentials` PUT → `StoreCredentialStatusDto`; `useDisconnectStoreCredentials` DELETE; apps/status query invalidated on success; `ApiError` on 422/503. Recovery: if the run hangs > ~120s, in another shell `pkill -9 -f vitest`, clear no state, and re-run this single file. Gate rule: any red or `no test files` → FAIL.

- [ ] **Step 11: E7 RcSettingsPage test — solo, green (vitest, one file, run AFTER Step 10 finishes).**
  Run (from `dashboard/`):
  ```bash
  npx vitest run src/features/revenuecat/components/rc-settings.test.tsx
  ```
  Expected: `Test Files  1 passed (1)`. Covers (MSW): per-app list renders name + platform badge + status (`Not connected` / `Connected` / `Connected · live-verify pending`); Google Connect dialog (service-account JSON, native controls) success → Connected + toast; Apple Connect dialog (Issuer/Key/.p8/appAppleId, bundleId read-only) success; 422 field errors inline; 503 → "Set STORE_CREDENTIALS_ENC_KEY on the server first."; viewer read-only (write controls hidden); disconnect → Not connected; empty-state → Products-page link; the RevenueCat `IntegrationsSection` is **absent** from `RcSettingsPage`. Recovery: same `pkill -9 -f vitest` note. Gate rule: run these two vitest files **one at a time** (never a whole-dir vitest run — Radix Select hangs jsdom, and back-to-back files can starve the runner); any red → FAIL.

- [ ] **Step 12: WIP-safety — working tree = the user's known WIP set ONLY.**
  Run (from repo root):
  ```bash
  git status --porcelain
  ```
  Expected — EXACTLY this set and nothing else (the E1–E7 task files are all committed, so none appear here):
  ```
   M dashboard/src/components/layout/AppLayout.tsx
   M dashboard/src/components/layout/OrgSwitcher.tsx
   M dashboard/src/components/layout/ProjectSwitcher.tsx
   M dashboard/src/components/layout/ToolRail.tsx
   M dashboard/src/components/layout/app-layout.test.tsx
   M dashboard/src/components/layout/nav-model.ts
   M dashboard/src/components/layout/org-switcher.test.tsx
   M dashboard/src/components/layout/project-switcher.test.tsx
   M dashboard/src/features/command-palette/CommandPalette.tsx
   M dashboard/src/test/render-app.tsx
   M sdk/flutter_purchases/example/lib/demo_config.dart
  ?? dashboard/src/components/layout/RailInitial.tsx
  ?? docs/superpowers/plans/2026-07-16-dashboard-tool-rail.md
  ?? docs/superpowers/specs/2026-07-16-dashboard-tool-rail-design.md
  ```
  Note (leave untouched): `nav-model.ts` (and, if present, `nav-model.test.ts`) additionally carries this session's committed-logic **nav de-gate** edit awaiting the user's own commit — do NOT stage, commit, or revert it. Gate rule: any `store-credentials`, `RcSettingsPage`, or other E file showing up here means an E task left work uncommitted → FAIL (the E tasks must have `git add`-ed only their own files, never `-A`). Any file OUTSIDE the set above → FAIL. Nothing may be **staged** (no `A`/`M` in column 1).

- [ ] **Step 13: WIP-safety — no E-range commit touched a WIP file or added a co-author trailer.**
  Determine the E range (first E commit `^..HEAD`; substitute the actual first-E-commit sha as `<E0>`), then:
  ```bash
  git log --oneline <E0>^..HEAD -- \
    dashboard/src/components/layout/ \
    dashboard/src/features/command-palette/CommandPalette.tsx \
    dashboard/src/test/render-app.tsx \
    sdk/flutter_purchases/example/lib/demo_config.dart
  ```
  Expected output: **empty** (zero lines — no E commit touched the collapse-rail / nav / render-app / demo_config WIP). Then:
  ```bash
  git log <E0>^..HEAD --format='%H %s%n%b' | grep -i -E 'co-authored-by|claude-flow|ruv@ruv.net' || echo "no co-author trailers"
  ```
  Expected output:
  ```
  no co-author trailers
  ```
  Also spot-confirm every E-range subject is `feat(mobile_purchase):` / `feat(dashboard):` / `test(...):`. Gate rule: any WIP-file line in the first grep, or any co-author/trailer hit in the second → FAIL.

- [ ] **Step 14: APPEND the E-complete ledger entry to `progress.md` (no git add/commit).**
  `.superpowers/` is gitignored — this file is edited but NEVER staged or committed. Append (mirror the D3.3 gate-entry style; fill `<...>` with the real observed values from Steps 2–13):
  ```
  Task E8 (verify gate): complete — ALL checks PASS. (1) mobile_purchase tsc 0; (2) cipher spec green solo (<n> — round-trip / dot-shape / wrong-key / tamper / non-32B StoreCipherError); (3) blob-types spec green solo (<n> — Google+Apple valid + every malformed field 422 + kind/platform-mismatch 409) + validator spec green solo (<n> — InMemory verified/rejected/unavailable/generic branches recorded, real impl throws StoreValidationUnavailableError); (4) StoreCredentialsService Testcontainers spec green solo (<n> — happy connected + pending-when-live-unavailable + 409 + 503 + 502-no-write + cross-scope 404 + secret-never-returned + idempotent disconnect); (5) store-credentials e2e green solo (<n> — 200 admin/403 viewer/401/404/422/204/storeConnected-no-blob, Docker up); (6) requireCredentials-decrypt spec green solo (<n> — stored→decrypt→SA / null→throws / no-key→throws / bad-blob→throws; googleapis network call STAYS gated); (7) FULL mobile_purchase suite green (<S> suites / <T> tests, 0 failed — grew from the D-era 64/585 by the five new E spec files + E5 cases folded into store-client.google-api.spec.ts; Docker up; benign worker-exit warning only); (8) dashboard tsc 0 (user collapse-rail WIP still compiles); (9) store-credentials-api.test.ts green solo (<n>) + rc-settings.test.tsx green solo (<n>) — run one-at-a-time via npx vitest run (Radix-Select-in-jsdom hang avoided; pkill -9 -f vitest recovery unused/used); (10) WIP-safe: git status = the user's collapse-rail WIP set ONLY (layout/* + nav-model.ts[+nav-model.test.ts, carrying this session's committed-logic nav de-gate edit — left for the user] + CommandPalette + render-app + RailInitial + demo_config + the two tool-rail docs), nothing staged; ZERO E-range commits (<E0>..HEAD) touch any WIP file; no co-author trailers; all E subjects feat(mobile_purchase):/feat(dashboard):/test(...):. Live-store-network + real-creds validation stay OUT of scope (creds-gated seams still throw). NOT pushed/merged.
  === SUB-PROJECT E (Connect Stores — store-credential management) COMPLETE. AES-256-GCM cipher (E1) + typed/Zod credential blobs + creds-gated live-validator seam (E2) + storeCredentialsVerifiedAt/LiveVerified schema + StoreCredentialsService set/status/disconnect (E3) + PUT/GET-status/DELETE endpoints + apps-list storeConnected (E4) + requireCredentials decrypt wiring (E5) + dashboard store-credentials-api hooks (E6) + RcSettingsPage per-app connect/manage/disconnect list, IntegrationsSection removed from RcSettingsPage only (E7). Structural validation always runs; live verification is a creds/SDK-gated drop-in (pending posture today). NOT pushed/merged. ===
  ```
  Do **not** run `git add .superpowers/...` — verify it stays out of the index:
  ```bash
  git status --porcelain .superpowers/
  ```
  Expected output: **empty** (gitignored — no line). Gate rule: if `.superpowers/` shows up in `git status`, it is not gitignored as assumed → STOP and report (do not commit it).

- [ ] **Step 15: Final gate verdict.**
  Confirm Steps 2–13 all PASS and Step 14 appended cleanly. If every check is green, E8 is complete and Sub-project E is merge-ready (NOT pushed/merged — the user merges). If any step failed, the gate FAILS: report the exact failing step + command output to the orchestrator; do not append a "PASS" ledger entry, do not paper over a red with a re-run, and do not touch any WIP file to "fix" a compile error (a WIP-caused failure is reported, not edited).

**ABSOLUTE RULES honored:** no source/test written (verify-only); every command is exact and copy-runnable against the real scripts (`npm run typecheck`, `npm test`, `npx jest <path>`, `npx vitest run <file>`); `.superpowers/progress.md` is appended but never staged/committed; no `git add -A`; no co-author trailer; no WIP file touched; live-store-network + real-creds validation explicitly out of scope.

---

