import type { Request } from 'express';
import { clientIp } from './client-ip';

function request(headers: Record<string, string | string[]>, remoteAddress?: string): Request {
  return { headers, socket: { remoteAddress } } as unknown as Request;
}

describe('clientIp', () => {
  it('takes the LAST X-Forwarded-For hop — the one our own edge appended', () => {
    // A client that forges the header only prepends to it; the entry the proxy adds is the peer
    // that actually connected, so the forged one must never win.
    expect(clientIp(request({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('reads a single-hop header', () => {
    expect(clientIp(request({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('joins a repeated header before picking the last hop', () => {
    expect(clientIp(request({ 'x-forwarded-for': ['1.2.3.4', '203.0.113.7'] }))).toBe('203.0.113.7');
  });

  it('falls back to X-Real-IP, then to the socket address', () => {
    expect(clientIp(request({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(request({}, '203.0.113.10'))).toBe('203.0.113.10');
  });

  it('unwraps the port and IPv4-mapped forms a proxy or Node adds', () => {
    expect(clientIp(request({ 'x-forwarded-for': '[2001:db8::1]:443' }))).toBe('2001:db8::1');
    expect(clientIp(request({ 'x-forwarded-for': '203.0.113.7:51000' }))).toBe('203.0.113.7');
    expect(clientIp(request({}, '::ffff:203.0.113.7'))).toBe('203.0.113.7');
    expect(clientIp(request({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('is empty when there is nothing usable, rather than inventing an address', () => {
    expect(clientIp(request({}))).toBe('');
    expect(clientIp(request({ 'x-forwarded-for': '  ,  ' }))).toBe('');
  });

  it('caps a junk header at the longest an address can be', () => {
    expect(clientIp(request({ 'x-forwarded-for': 'x'.repeat(5000) }))).toHaveLength(45);
  });
});
