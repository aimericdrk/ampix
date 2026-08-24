#!/usr/bin/env node
// Prints the current RFC 6238 TOTP code for a base32 secret (SHA-1, 30s, 6 digits).
// Used by scripts/k8s/local.sh to exercise the admin console's 2FA flow end-to-end.
import { createHmac } from 'node:crypto';
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const secretB32 = process.argv[2];
if (!secretB32) { console.error('usage: totp-code.mjs <base32-secret> [unix-seconds]'); process.exit(1); }
let bits = 0, value = 0; const bytes = [];
for (const ch of secretB32.toUpperCase().replace(/=+$/, '')) {
  const idx = ALPHA.indexOf(ch);
  if (idx === -1) { console.error('invalid base32'); process.exit(1); }
  value = (value << 5) | idx; bits += 5;
  if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
}
const t = Number(process.argv[3] ?? Math.floor(Date.now() / 1000));
const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(t / 30)));
const mac = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
const off = mac[mac.length - 1] & 0x0f;
const code = (((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]) % 1e6;
console.log(String(code).padStart(6, '0'));
