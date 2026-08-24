import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 4226 (HOTP) / RFC 6238 (TOTP) with RFC 4648 base32 — hand-rolled, no OTP dependency, so the
 * exact behavior is unit-tested against the RFC vectors. SHA-1, 30 s step, 6 digits, ±1 window:
 * the parameters every authenticator app defaults to.
 */
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer | null {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code =
    (((mac[offset]! & 0x7f) << 24) |
      ((mac[offset + 1]! & 0xff) << 16) |
      ((mac[offset + 2]! & 0xff) << 8) |
      (mac[offset + 3]! & 0xff)) %
    10 ** digits;
  return code.toString().padStart(digits, '0');
}

export const TOTP_STEP_SECONDS = 30;

export function totp(secret: Buffer, unixSeconds: number, digits = 6): string {
  return hotp(secret, Math.floor(unixSeconds / TOTP_STEP_SECONDS), digits);
}

/** Constant-time comparison of a submitted code against the ±window steps around now. */
export function verifyTotp(secretB32: string, code: string, unixSeconds = Date.now() / 1000, window = 1): boolean {
  const secret = base32Decode(secretB32);
  if (!secret || secret.length === 0) return false;
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(unixSeconds / TOTP_STEP_SECONDS);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(secret, counter + i);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) return true;
  }
  return false;
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160-bit secret, RFC 4226 recommendation
}

export function otpauthUri(secretB32: string, accountEmail: string, issuer = 'MyAmpix Ops'): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(accountEmail)}?secret=${secretB32}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}
