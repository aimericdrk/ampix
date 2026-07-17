import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';

const logger = new Logger('AppleRootCerts');

/** Files in the certs directory that are documentation/metadata, not certificates. */
const IGNORED_ENTRIES = new Set(['readme.md', '.gitkeep']);

/**
 * Loads every regular, non-ignored file in `dir` as a root-certificate Buffer for Apple's
 * `SignedDataVerifier`. PEM or DER both work — `node:crypto`'s `X509Certificate` auto-detects the
 * encoding, so the loader itself stays format-agnostic (design §8: the seam, not the asset).
 *
 * A missing directory or an empty one both return `[]` — the documented placeholder state before
 * the real Apple Root CA – G3 cert is dropped in (see `certs/README.md`). Returning `[]` rather
 * than throwing lets the service boot; `buildAppleSignedDataVerifiers` turns an empty cert list
 * into zero verifiers, so `AppleNotificationVerifier` fails closed (401 on every notification)
 * instead of silently trusting nothing-in-particular.
 */
export function loadAppleRootCertificates(dir: string): Buffer[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    logger.warn(`Apple root cert directory not found or unreadable: ${dir} — no trust anchor configured`);
    return [];
  }

  const certs: Buffer[] = [];
  for (const entry of entries) {
    if (IGNORED_ENTRIES.has(entry.toLowerCase()) || entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    if (!statSync(fullPath).isFile()) continue;
    certs.push(readFileSync(fullPath));
  }

  if (certs.length === 0) {
    logger.warn(
      `No Apple root certificates found in ${dir} — Apple webhook verification will reject ` +
        'every notification until the real Apple Root CA - G3 cert is added (see certs/README.md)',
    );
  }

  return certs;
}
