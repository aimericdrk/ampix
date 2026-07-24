# MyRevenueCat — Connect Stores (store-credential management) — Design

**Goal:** Replace MyRevenueCat's "Integration settings" (today a connect-to-**real-RevenueCat** API-key form) with a **connect-your-stores** flow: per app, provide the store credentials the self-hosted clone needs to talk to the stores **directly** — a **Google Play service account** and an **Apple App Store Connect API key + ASSN config** — stored encrypted, with a connection status and disconnect. This builds the deferred "connect-store flow" that `App.storeCredentials` was scaffolded for, and it lights up the already-built creds-gated backend paths (e.g. the D1 refund) the moment a real credential is stored.

**Design principle:** Do EXACTLY what RevenueCat does. RC connects to the stores on your behalf via a **Google Play service account** (Play Developer API) and an **App Store Connect API key** (issuer id / key id / .p8) — the user pastes those into RC. The clone collects the *same* credentials and uses them itself, so there is nothing to connect to RevenueCat for. The legacy real-RevenueCat connect flow stays as a transitional analytics import (locked scope: "keep the mirror as a legacy import during transition") — it just leaves MyRevenueCat's settings.

**This is a new creds-free sub-project.** Storing, structurally validating, and encrypting credentials needs no real store account; only the *live* API validation and the eventual live store calls need real credentials + the store SDKs — those are built as creds-gated seams (tested against fakes), exactly like the D1 refund's store call.

---

## §0. Constraints & principles

- **Per-app credentials (user decision).** Store credentials attach to an `App` (one row per project × platform × bundleId/packageName). The settings UI is a **per-app list**: every app in the project, its platform, its connection status, and a connect/manage/disconnect action. A project with an iOS app + an Android app connects each separately.
- **Validate-live posture = store + structural-validate now, live-verify when creds exist (user decision, "recommended").** On Connect: (1) structural validation (Zod) always runs — valid service-account JSON / valid `.p8` + issuer/key format; (2) a **creds-gated live validation** runs when the store SDKs + a reachable store are available, else the app is marked **`connected` / live-verification `pending`**. The live validator is a real seam tested against mocked store responses; its real network impl is the creds/SDK-gated drop-in. No credential is ever stored that fails **structural** validation.
- **Apple collects both (user decision):** the **App Store Connect API key** (`issuerId`, `keyId`, `.p8` private key) for server-to-server calls, AND the **ASSN inbound config** (`appAppleId` — the numeric ASC app id needed for Production notification verification; `bundleId` already lives on the `App`). The inbound ASSN *certificate* verification (root certs) stays as it is — separate concern.
- **Encryption at rest.** Credentials are encrypted with **AES-256-GCM** keyed by `STORE_CREDENTIALS_ENC_KEY` (provisioned but unused today) and stored in the existing `App.storeCredentials` blob column. The plaintext secret is **never** returned by any read endpoint (status only). If `STORE_CREDENTIALS_ENC_KEY` is unset, the set endpoint returns **503** (can't encrypt) — same fail-closed posture as the store-client.
- **Reuse the existing App + authz seams.** Credentials hang off the existing `App` rows (created on the Products page). Admin-gated writes (`@RequireProjectRole('admin')`), viewer-gated status reads, `ProblemException` errors, double-scoped by `projectId`. No new store client is invented; the **decrypt path is wired into `GoogleApiStoreClient.requireCredentials`** (which throws today) so stored creds flow to the existing methods (the real network call stays gated on the `googleapis` wiring).
- **Keep RevenueCat legacy where it is.** The `mobile_analytics` `RevenueCatIntegration` connect flow (`IntegrationsSection`) is NOT deleted — it stays in project settings / analytics as the transitional import. Only MyRevenueCat's `RcSettingsPage` stops rendering it.
- **HARD WIP rule** (always in force): never touch the user's uncommitted collapse-rail WIP (`dashboard/src/components/layout/*`, `nav-model.ts`, `CommandPalette.tsx`, `render-app.tsx`, `RailInitial.tsx`, `demo_config.dart`). Never commit `.env`/secrets/`.p8`/service-account JSON. No co-author trailers. The user merges. (Note: `nav-model.ts` currently also carries this session's committed-logic nav de-gate edit awaiting the user's commit — leave it.)

## §1. Backend (`mobile_purchase`, additive)

### §1.1 Encryption helper (`src/common/crypto/store-credentials-cipher.ts`)
`encryptStoreCredentials(plaintext: string, keyB64: string): string` and `decryptStoreCredentials(blob: string, keyB64: string): string` — AES-256-GCM, random 12-byte IV per encryption, output `base64(iv).base64(tag).base64(ciphertext)` (a self-describing string in the one `storeCredentials` column). Throws a typed error on a bad key length or a tamper/decrypt failure. `STORE_CREDENTIALS_ENC_KEY` becomes a validated 32-byte (base64) config value (still optional at boot — absence only fails the connect path, not startup).

### §1.2 Credential blobs (typed + Zod, `src/catalog/store-credentials/store-credential.types.ts`)
The decrypted plaintext is a JSON blob, discriminated by the App's platform:
- **Google (`ANDROID`):** `{ kind: 'google_play'; serviceAccountJson: string }` — `serviceAccountJson` structurally validated as JSON with `type === 'service_account'`, `client_email`, `private_key`, `project_id`.
- **Apple (`IOS`):** `{ kind: 'app_store'; ascIssuerId: string; ascKeyId: string; ascPrivateKeyP8: string; appAppleId: string }` — `ascKeyId` 10-char, `ascIssuerId` a UUID, `ascPrivateKeyP8` a PEM `-----BEGIN PRIVATE KEY-----` block, `appAppleId` numeric.

The blob's `kind` must match the target App's `platform` (mismatch → 409).

### §1.3 Live-validation seam (`src/catalog/store-credentials/store-credential-validator.ts`)
`StoreCredentialValidator.validate(app, blob): Promise<{ liveVerified: boolean }>` — a creds-gated seam mirroring the `StoreClient` pattern:
- **Real impl** (`GoogleApiCredentialValidator` / `AppStoreConnectCredentialValidator`): would call the Play Developer API / sign an ASC JWT and hit App Store Connect. Until the store SDKs (`googleapis`, an ASC JWT/HTTP path) are wired, it throws `StoreValidationUnavailableError` (the connect endpoint treats that as `liveVerified: false`, `pending`), exactly how `GoogleApiStoreClient` is creds-gated today.
- **`InMemory` double** drives every branch (verified / rejected / unavailable) in tests.
Structural validation is a pure function that always runs first, independent of the live seam.

### §1.4 Endpoints (on the existing App, `src/catalog/controllers/apps.controller.ts` + a new service)
- **`PUT /api/v1/projects/:projectId/catalog/apps/:appId/store-credentials`** — admin. Body = the platform blob. Flow: load+scope the App (404) → `kind` matches platform (409) → structural validation (422 with field errors) → `STORE_CREDENTIALS_ENC_KEY` present (503) → attempt live validation (creds-gated → `pending` when unavailable, 502 on an actual store rejection) → encrypt → `app.storeCredentials = cipher` → return status `{ connected: true, platform, liveVerified, lastValidatedAt }` (**never** the secret).
- **`GET .../apps/:appId/store-credentials/status`** — viewer. `{ connected: boolean, platform, liveVerified?: boolean, lastValidatedAt?: Date }`, derived without decrypting (connected = `storeCredentials !== null`; `liveVerified`/`lastValidatedAt` from small non-secret columns — see §1.5). Also surfaced as a `storeConnected` boolean on the existing apps-list response so the per-app list needs one call.
- **`DELETE .../apps/:appId/store-credentials`** — admin, `@HttpCode(204)`. Clears `storeCredentials` (disconnect); idempotent.

### §1.5 Schema (additive, one migration)
`App` gains two **non-secret** status columns so status reads never decrypt: `storeCredentialsVerifiedAt DateTime?` and `storeCredentialsLiveVerified Boolean @default(false)`. `storeCredentials` (the encrypted blob) already exists. No other model changes. (`storeConnected` in responses is derived, not stored.)

### §1.6 Decrypt wiring into the store client
`GoogleApiStoreClient.requireCredentials(packageName)` (throws `GoogleCredentialsUnavailableError` today) is updated: if the resolved App has `storeCredentials`, **decrypt** it (via §1.1) and return the parsed Google service account; only throw `GoogleCredentialsUnavailableError` when it's null/undecryptable. The actual `googleapis` network call in `getSubscriptionV2`/`revokeAndRefundSubscription` stays a creds/SDK-gated drop-in (still throws until wired) — so this doesn't accidentally "turn on" live store calls, it just makes the stored credential *reachable*.

## §2. Dashboard (MyRevenueCat)

- **`RcSettingsPage`** stops rendering the RevenueCat `IntegrationsSection`. It renders a **per-app connection list**: for each `App` (from `useRcApps`), a row with the app name, platform badge, and status (`Not connected` / `Connected` / `Connected · live-verify pending`), plus **Connect / Manage / Disconnect** (admin only; viewers see read-only status). Empty state when the project has no apps yet → link to the Products page to create one.
- **Connect/Manage dialog**, platform-specific (native form controls, B's dialog pattern — never Radix Select):
  - **Google Play:** a service-account-JSON field (paste or file-upload of the `.json`), with inline structural feedback.
  - **Apple App Store:** Issuer ID, Key ID, `.p8` (paste/upload), App Store Connect app ID (`appAppleId`). Bundle ID shown read-only from the App.
  - Submit → `useSetStoreCredentials` → on success close + toast (`Store connected` / `Connected — live verification pending`), the row refetches to Connected; structural/422 errors shown inline in the dialog; 503 → "Set STORE_CREDENTIALS_ENC_KEY on the server first."
- **API hooks** (`features/revenuecat/store-credentials-api.ts`): `useStoreCredentialStatus`/the `storeConnected` field on the apps list, `useSetStoreCredentials(projectId, appId)`, `useDisconnectStoreCredentials(projectId, appId)` over `purchaseApiFetch`; invalidate the apps/status query on success. `TError = ApiError`.
- The credential secret is **never** sent back to the client; the dialog is always a fresh entry (managing = re-enter to replace).

## §3. Data flow & error handling
Admin opens an app's Connect dialog → submits the platform credential → `useSetStoreCredentials` → `PUT …/store-credentials` → validate (structural 422 / platform-mismatch 409 / no-enc-key 503 / live-store-rejection 502) → encrypt → store → 200 status. Compute-on-read is unaffected. Once stored, `requireCredentials` can decrypt the credential for the existing store-client methods (their live network call remains gated). All errors are RFC-7807 `ProblemException` → `ApiError` → dialog/toast.

## §4. Testing
- **Backend:** cipher round-trip + tamper/failure + bad-key unit tests; structural-validation unit tests per platform (valid + each malformed field); Testcontainers service spec for set/status/disconnect (happy connected + `pending`-when-live-unavailable + platform-mismatch 409 + no-enc-key 503 + cross-project/app 404 + secret-never-returned); the validator seam's branches via the InMemory double; a `requireCredentials`-decrypts test (stored cred → decrypts → returns; null → throws); e2e (200 admin / 403 viewer / 401 / 404 / 422 malformed).
- **Dashboard:** MSW — per-app list renders status; Connect dialog (Google + Apple) success → Connected; structural 422 inline; 503 hint; viewer sees read-only; disconnect → Not connected. One file at a time (vitest).
- **Gate:** both tscs 0; full `mobile_purchase` suite; dashboard revenuecat suite; WIP-safety; no co-author.

## §5. Build order (its own plan → SDD; backend before dashboard)
1. **E1** — cipher helper + `STORE_CREDENTIALS_ENC_KEY` config hardening + unit tests.
2. **E2** — credential blob types + structural validation + the creds-gated validator seam (+ InMemory double) + unit tests.
3. **E3** — schema migration (`storeCredentialsVerifiedAt`, `storeCredentialsLiveVerified`) + the store-credentials service (set/status/disconnect) + Testcontainers spec.
4. **E4** — controller endpoints + apps-list `storeConnected` + module wiring + e2e.
5. **E5** — decrypt wiring into `GoogleApiStoreClient.requireCredentials` + spec.
6. **E6** — dashboard `store-credentials-api.ts` hooks + MSW tests.
7. **E7** — `RcSettingsPage` per-app list + Connect/Manage/Disconnect dialogs (Google + Apple) + MSW page tests; remove the RevenueCat `IntegrationsSection` from `RcSettingsPage` only.
8. **E8** — verify gate.

## §6. Out of scope (explicit)
- **The live store network wiring** (`googleapis` Play Developer client, ASC JWT/HTTP client) and the actual live validation call — creds/SDK-gated drop-ins; E ships the seam + `pending` posture. Populating real credentials + the live call is procurement-gated (X1 / real store accounts).
- **Product auto-import from the stores** (store sync) — separately deferred; products stay manually entered.
- **Per-app RTDN Pub/Sub topic provisioning** and Apple ASSN endpoint registration in the stores — those are store-console + deploy (X1) concerns; the clone already ingests RTDN/ASSN via global config.
- **Deleting the legacy RevenueCat integration** — it stays as the transitional analytics import; E only removes it from `RcSettingsPage`.
- **Rotating `STORE_CREDENTIALS_ENC_KEY`** / re-encryption tooling — future ops concern.

## §7. Reference — key existing symbols
- `App` (`prisma/schema.prisma:91-111`): `platform: AppPlatform`, `bundleId?`, `packageName?`, `publicSdkKey`, `storeCredentials String?` (encrypted blob, currently always null); `apps.service.ts` `omit: { storeCredentials: true }`. App CRUD = `catalog/controllers/apps.controller.ts` (list/create/delete — **no update yet**).
- `STORE_CREDENTIALS_ENC_KEY` (`config/app-config.ts:26`, optional, unused). No aes-gcm helper exists yet.
- Store seam: `store-client.google-api.ts` `requireCredentials` (throws `GoogleCredentialsUnavailableError` today); `GOOGLE_STORE_CLIENT` token. Apple inbound config: `APPLE_BUNDLE_IDS`/`APPLE_APP_APPLE_ID`/`APPLE_ROOT_CERT_DIR` (`config/app-config.ts:30-37`). No ASC API-key config exists yet (net-new here).
- Guards: `ProjectAccessGuard` + `@RequireProjectRole`; `ProblemException` (`common/problem-details`); `parseOrThrow` (`common/zod`).
- Dashboard: `purchaseApiFetch` (`lib/api/purchase-client.ts`), `useRcApps`/catalog-api, `RcSettingsPage` + `IntegrationsSection` (the RC card to remove from RcSettingsPage), `useProjectRole`.
- Legacy RC (kept): `mobile_analytics` `RevenueCatIntegration` model + `rc-admin.controller.ts` (`…/integrations/revenuecat`) + `IntegrationsSection` (stays in project settings).
