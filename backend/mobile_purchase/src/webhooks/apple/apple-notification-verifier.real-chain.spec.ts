import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { AppleNotificationVerifier, AppleSignatureError } from './apple-notification-verifier';

/**
 * The "desirable" end-to-end test from the M2a brief: generates a self-signed test CA chain
 * (root -> intermediate -> leaf, all EC P-256/ES256, with Apple's proprietary marker OIDs that
 * `SignedDataVerifier`'s chain check requires — 1.2.840.113635.100.6.2.1 on the intermediate,
 * 1.2.840.113635.100.6.11.1 on the leaf), signs a real ASSN v2-shaped JWS with an x5c header, and
 * proves the REAL `SignedDataVerifier` (not a mock) accepts it via `AppleNotificationVerifier`,
 * and rejects a tampered token with `AppleSignatureError`. Uses `openssl` (not node-forge — forge
 * has no usable EC keygen/signing path) to build the chain; if `openssl` is unavailable this
 * suite is skipped rather than failing the run.
 */
const BUNDLE_ID = 'com.myampix.app';
const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const describeIfOpenssl = hasOpenssl ? describe : describe.skip;

describeIfOpenssl('AppleNotificationVerifier against a real generated x5c chain (SignedDataVerifier, not mocked)', () => {
  let dir: string;
  let rootCertPem: Buffer;
  let leafCertPem: Buffer;
  let intermediateCertPem: Buffer;
  let leafKeyPem: string;
  let validToken: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'apple-real-chain-'));
    const openssl = (args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });

    // Root CA (EC P-256, self-signed) — this is the trust anchor SignedDataVerifier is configured
    // with; unlike the leaf/intermediate it needs no Apple-specific extension.
    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'root-key.pem']);
    openssl([
      'req', '-new', '-x509', '-key', 'root-key.pem', '-days', '3650', '-out', 'root-cert.pem',
      '-subj', '/C=US/O=Test Apple Root/CN=Test Apple Root CA - G3',
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    ]);

    // Intermediate CA, signed by root — requires SignedDataVerifier's
    // "1.2.840.113635.100.6.2.1" marker extension + CA:TRUE to pass verifyCertificateChain.
    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'intermediate-key.pem']);
    openssl([
      'req', '-new', '-key', 'intermediate-key.pem', '-out', 'intermediate.csr',
      '-subj', '/C=US/O=Test Apple Worldwide Developer Relations/CN=Test WWDR CA',
    ]);
    writeFileSync(
      join(dir, 'intermediate-ext.cnf'),
      'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n1.2.840.113635.100.6.2.1=ASN1:NULL\n',
    );
    openssl([
      'x509', '-req', '-in', 'intermediate.csr', '-CA', 'root-cert.pem', '-CAkey', 'root-key.pem',
      '-CAcreateserial', '-days', '3650', '-out', 'intermediate-cert.pem', '-extfile', 'intermediate-ext.cnf',
    ]);

    // Leaf cert, signed by the intermediate — requires the "1.2.840.113635.100.6.11.1" marker.
    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf-key.pem']);
    openssl([
      'req', '-new', '-key', 'leaf-key.pem', '-out', 'leaf.csr',
      '-subj', '/C=US/O=Test Apple/CN=Test In-App Purchase Signing',
    ]);
    writeFileSync(
      join(dir, 'leaf-ext.cnf'),
      'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.6.11.1=ASN1:NULL\n',
    );
    openssl([
      'x509', '-req', '-in', 'leaf.csr', '-CA', 'intermediate-cert.pem', '-CAkey', 'intermediate-key.pem',
      '-CAcreateserial', '-days', '3650', '-out', 'leaf-cert.pem', '-extfile', 'leaf-ext.cnf',
    ]);

    rootCertPem = readFileSync(join(dir, 'root-cert.pem'));
    intermediateCertPem = readFileSync(join(dir, 'intermediate-cert.pem'));
    leafCertPem = readFileSync(join(dir, 'leaf-cert.pem'));
    leafKeyPem = readFileSync(join(dir, 'leaf-key.pem'), 'utf8');

    const x5c = [leafCertPem, intermediateCertPem, rootCertPem].map((pem) => new X509Certificate(pem).raw.toString('base64'));

    validToken = jwt.sign(
      {
        notificationType: 'SUBSCRIBED',
        subtype: 'INITIAL_BUY',
        notificationUUID: 'real-chain-uuid-1',
        version: '2.0',
        signedDate: Date.now(),
        data: { bundleId: BUNDLE_ID, environment: 'Sandbox' },
      },
      leafKeyPem,
      { algorithm: 'ES256', header: { alg: 'ES256', x5c } },
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('verifies a genuinely-signed notification through the real SignedDataVerifier', async () => {
    const signedDataVerifier = new SignedDataVerifier([rootCertPem], false, Environment.SANDBOX, BUNDLE_ID, undefined);
    const verifier = new AppleNotificationVerifier([signedDataVerifier]);

    const decoded = await verifier.verifyAndDecode(validToken);

    expect(decoded.notificationType).toBe('SUBSCRIBED');
    expect(decoded.notificationUUID).toBe('real-chain-uuid-1');
    expect(decoded.bundleId).toBe(BUNDLE_ID);
  });

  it('rejects a tampered payload (signature no longer matches) with AppleSignatureError', async () => {
    const signedDataVerifier = new SignedDataVerifier([rootCertPem], false, Environment.SANDBOX, BUNDLE_ID, undefined);
    const verifier = new AppleNotificationVerifier([signedDataVerifier]);

    const [header, payload, signature] = validToken.split('.');
    const tamperedPayload = Buffer.from(payload, 'base64url').toString('utf8').replace('SUBSCRIBED', 'REFUND     ');
    const tampered = `${header}.${Buffer.from(tamperedPayload, 'utf8').toString('base64url')}.${signature}`;

    await expect(verifier.verifyAndDecode(tampered)).rejects.toBeInstanceOf(AppleSignatureError);
  });

  it('rejects a notification signed for a different bundleId', async () => {
    const otherBundleToken = jwt.sign(
      {
        notificationType: 'SUBSCRIBED',
        notificationUUID: 'real-chain-uuid-2',
        signedDate: Date.now(),
        data: { bundleId: 'com.someone.else', environment: 'Sandbox' },
      },
      leafKeyPem,
      {
        algorithm: 'ES256',
        header: {
          alg: 'ES256',
          x5c: [leafCertPem, intermediateCertPem, rootCertPem].map((pem) => new X509Certificate(pem).raw.toString('base64')),
        },
      },
    );
    const signedDataVerifier = new SignedDataVerifier([rootCertPem], false, Environment.SANDBOX, BUNDLE_ID, undefined);
    const verifier = new AppleNotificationVerifier([signedDataVerifier]);

    await expect(verifier.verifyAndDecode(otherBundleToken)).rejects.toBeInstanceOf(AppleSignatureError);
  });
});
