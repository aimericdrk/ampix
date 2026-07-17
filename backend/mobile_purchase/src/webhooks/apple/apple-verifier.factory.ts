import { join } from 'node:path';
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import type { AppConfig } from '../../config/app-config';
import { loadAppleRootCertificates } from './apple-root-certs';
import type { AppleVerifierLike } from './apple-notification-verifier';

/** `APPLE_ROOT_CERT_DIR` unset falls back to the `certs/` directory shipped next to this file —
 * resolved via `__dirname` so it works whether running from `src` (ts-jest/dev) or the built
 * `dist` (nest-cli.json copies `certs/**` as an asset). */
function defaultRootCertDir(): string {
  return join(__dirname, 'certs');
}

/**
 * Builds one `SignedDataVerifier` per (configured bundleId × accepted environment) combination,
 * so `AppleNotificationVerifier` can accept a notification for any configured app in either Apple
 * environment (design §1.1: "both are valid"). Production requires `appAppleId` (Apple's library
 * throws in its constructor otherwise), so a Production verifier is only built when one is
 * configured — Sandbox-only deployments (the common case pre-launch) are still fully supported.
 *
 * M2a is intentionally config-driven (`APPLE_BUNDLE_IDS`), not a DB lookup — App-by-bundleId
 * resolution is M2b's job. See the M2a report for the multi-tenant follow-up this implies.
 *
 * An empty/missing root-cert directory yields `[]` (no verifiers) rather than throwing, so the
 * service still boots with Apple ingest failing closed (401 on everything) until the real Apple
 * Root CA – G3 cert is dropped in — see `certs/README.md`.
 */
export function buildAppleSignedDataVerifiers(config: AppConfig): AppleVerifierLike[] {
  const rootCertificates = loadAppleRootCertificates(config.appleRootCertDir ?? defaultRootCertDir());
  if (rootCertificates.length === 0) return [];

  const bundleIds = config.appleBundleIds ?? [];
  const appAppleId = config.appleAppAppleId;

  const verifiers: AppleVerifierLike[] = [];
  for (const bundleId of bundleIds) {
    // enableOnlineChecks: false — no OCSP/online revocation checking yet (design brief: flag as
    // a later hardening item, don't block M2a on it).
    // SECURITY: the environment MUST stay hardcoded to SANDBOX/PRODUCTION here. Apple's library
    // skips signature verification entirely for Environment.XCODE/LOCAL_TESTING — never let the
    // environment be selected from the incoming notification or an unvalidated config value, or
    // that becomes a verification bypass.
    verifiers.push(new SignedDataVerifier(rootCertificates, false, Environment.SANDBOX, bundleId, appAppleId));
    if (appAppleId !== undefined) {
      verifiers.push(new SignedDataVerifier(rootCertificates, false, Environment.PRODUCTION, bundleId, appAppleId));
    }
  }
  return verifiers;
}
