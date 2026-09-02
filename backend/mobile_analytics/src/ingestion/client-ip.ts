import type { Request } from 'express';

/**
 * The address an ingest batch was received FROM, for `events.ip`.
 *
 * It is read off the CONNECTION, never off the payload: everything an app says about itself is
 * forgeable (that is why `source` comes from the token), and an IP a client could set would be
 * worse than no IP at all.
 *
 * `X-Forwarded-For` is a list, and the only entry that is worth anything is the one OUR OWN edge
 * appended — the address that actually opened the connection to it. Every proxy in front of this
 * service (Caddy in the Compose deployment, the ingress in the Kubernetes one) appends the peer
 * address to whatever arrived, so that entry is the LAST one; anything a client forged sits
 * earlier in the list and is ignored here. Taking the first entry — the common shortcut — would be
 * taking exactly the part of the header a client controls.
 *
 * With no proxy in front (local dev, direct hits), there is no header and the socket address is
 * the real one. `X-Real-IP` sits in between: both nginx and traefik set it to the same peer
 * address, so it is a safe second choice when a deployment strips XFF but keeps it.
 *
 * Returns '' when nothing usable is present, which is what the column stores for "unknown".
 */
export function clientIp(req: Request): string {
  const forwarded = headerValue(req, 'x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',');
    const last = normalize(hops[hops.length - 1] ?? '');
    if (last) return last;
  }
  return normalize(headerValue(req, 'x-real-ip') ?? req.socket?.remoteAddress ?? '');
}

/** Express gives a repeated header as an array; join it back into one list before splitting. */
function headerValue(req: Request, name: string): string | undefined {
  const raw = req.headers?.[name];
  return Array.isArray(raw) ? raw.join(',') : raw;
}

/**
 * Trims the entry and unwraps the shapes a proxy adds around an address: `[::1]:443` (an IPv6
 * literal with a port), `203.0.113.7:1234` (an IPv4 with a port), and `::ffff:203.0.113.7` (the
 * IPv4-mapped IPv6 form Node reports for an IPv4 client on a dual-stack socket). Capped at 45
 * characters — the longest an address can be — so a junk header cannot write an unbounded string.
 */
function normalize(raw: string): string {
  let value = raw.trim();
  const closingBracket = value.indexOf(']');
  if (value.startsWith('[') && closingBracket !== -1) {
    value = value.slice(1, closingBracket);
  } else if (value.includes('.') && value.split(':').length === 2) {
    // A single colon alongside dots is `ipv4:port`; a bare IPv6 always has more than one.
    value = value.slice(0, value.indexOf(':'));
  }
  if (value.toLowerCase().startsWith('::ffff:') && value.includes('.')) {
    value = value.slice('::ffff:'.length);
  }
  return value.slice(0, 45);
}
