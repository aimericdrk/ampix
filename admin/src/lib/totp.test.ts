import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, totp, verifyTotp, generateTotpSecret } from './totp';
import { decodeKeyBytes, decryptSecret, encryptSecret, CryptoKeyError } from './crypto';

// RFC 4226 appendix D vectors — secret "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const HOTP_VECTORS = ['755224', '287082', '359152', '969429', '338314', '254676'];
// RFC 6238 appendix B (SHA-1 rows): time → code (8 digits; last 6 asserted via digits=8 check).
const TOTP_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
];

describe('hotp/totp (RFC vectors)', () => {
  it('matches RFC 4226 appendix D', () => {
    HOTP_VECTORS.forEach((v, i) => expect(hotp(RFC_SECRET, i)).toBe(v));
  });
  it('matches RFC 6238 appendix B (SHA-1, 8 digits)', () => {
    for (const [t, code] of TOTP_VECTORS) expect(totp(RFC_SECRET, t, 8)).toBe(code);
  });
});

describe('base32', () => {
  it('round-trips arbitrary buffers', () => {
    for (const s of ['f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      expect(base32Decode(base32Encode(Buffer.from(s)))!.toString()).toBe(s);
    }
  });
  it('rejects invalid characters', () => {
    expect(base32Decode('AB1!')).toBeNull(); // 1 and ! are not in the alphabet
  });
});

describe('verifyTotp', () => {
  const secret = base32Encode(RFC_SECRET);
  it('accepts the current and adjacent steps, rejects outside the window', () => {
    const now = 1234567890;
    const current = totp(RFC_SECRET, now);
    expect(verifyTotp(secret, current, now)).toBe(true);
    expect(verifyTotp(secret, totp(RFC_SECRET, now - 30), now)).toBe(true);
    expect(verifyTotp(secret, totp(RFC_SECRET, now + 30), now)).toBe(true);
    expect(verifyTotp(secret, totp(RFC_SECRET, now - 90), now)).toBe(false);
  });
  it('rejects malformed codes and bad secrets', () => {
    expect(verifyTotp(secret, '12345', 0)).toBe(false);
    expect(verifyTotp(secret, 'abcdef', 0)).toBe(false);
    expect(verifyTotp('!!notbase32!!', '123456', 0)).toBe(false);
  });
  it('generates 160-bit secrets and well-formed otpauth URIs', () => {
    const s = generateTotpSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(otpauthUri(s, 'ops@example.com')).toMatch(/^otpauth:\/\/totp\/MyAmpix%20Ops:ops%40example\.com\?secret=/);
  });
});

describe('crypto (AES-256-GCM)', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  it('round-trips and rejects tampering / wrong key', () => {
    const ct = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(decryptSecret(ct, key)).toBe('JBSWY3DPEHPK3PXP');
    const tampered = Buffer.from(ct, 'base64');
    tampered[tampered.length - 1] ^= 0xff;
    expect(decryptSecret(tampered.toString('base64'), key)).toBeNull();
    expect(decryptSecret(ct, Buffer.alloc(32, 8).toString('base64'))).toBeNull();
  });
  it('validates key material', () => {
    expect(decodeKeyBytes('a'.repeat(64))).toHaveLength(32);
    expect(decodeKeyBytes(Buffer.alloc(32, 1).toString('base64'))).toHaveLength(32);
    expect(decodeKeyBytes('too-short')).toBeNull();
    expect(() => encryptSecret('x', 'bad-key')).toThrow(CryptoKeyError);
  });
});
