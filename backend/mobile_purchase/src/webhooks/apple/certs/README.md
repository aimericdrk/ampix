# Apple root certificate trust anchor (design §8)

This directory is the trust-anchor seam for `AppleNotificationVerifier` (`apple-verifier.factory.ts`
/ `apple-root-certs.ts`): every regular file dropped in here is loaded as a root certificate (PEM or
DER — Node's `crypto.X509Certificate` auto-detects the encoding) and handed to Apple's
`SignedDataVerifier` as its trust anchor.

**This directory ships empty on purpose.** The real **Apple Root CA – G3** certificate is a
*public*, non-secret asset (download it from
https://www.apple.com/certificateauthority/), but it was not fetched as part of M2a (no network
access from the build environment, and it is gated on the App Store Connect enrollment done in X1 —
see design §8 "External prerequisites"). Until a `.pem`/`.cer` file is added here:

- `loadAppleRootCertificates()` returns `[]` (logs a warning).
- `buildAppleSignedDataVerifiers()` therefore builds **zero** verifiers.
- `AppleNotificationVerifier.verifyAndDecode()` fails closed with `AppleSignatureError` for every
  request (never silently accepts anything) — the correct behavior for a missing trust anchor.

**Before enabling live Apple ASSN v2 verification:**
1. Download the "Apple Root CA - G3 Root" certificate from the Apple PKI page above (PEM or DER).
2. Drop it in this directory (any filename, any of the two encodings).
3. Set `APPLE_BUNDLE_IDS` (and `APPLE_APP_APPLE_ID` for Production) to the real app identifiers —
   see `src/config/app-config.ts`.

Tests never use this directory or the real G3 cert — they inject a generated test root (or a mock)
directly into `AppleNotificationVerifier`'s constructor.
