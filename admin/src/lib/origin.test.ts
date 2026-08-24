import { describe, expect, it } from 'vitest';
import { assertSameOrigin, CrossOriginError } from './origin';

function req(headers: Record<string, string>): Request {
  return new Request('https://admin.example.com/api/x', { method: 'POST', headers });
}

describe('assertSameOrigin', () => {
  it('accepts matching Origin', () => {
    expect(() =>
      assertSameOrigin(req({ host: 'admin.example.com', origin: 'https://admin.example.com' })),
    ).not.toThrow();
  });

  it('prefers x-forwarded-host behind the ingress', () => {
    expect(() =>
      assertSameOrigin(
        req({
          host: 'pod-internal:3000',
          'x-forwarded-host': 'admin.example.com',
          origin: 'https://admin.example.com',
        }),
      ),
    ).not.toThrow();
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(() =>
      assertSameOrigin(req({ host: 'admin.example.com', referer: 'https://admin.example.com/login' })),
    ).not.toThrow();
  });

  it('rejects mismatched origin, missing origin+referer, and malformed origin', () => {
    expect(() =>
      assertSameOrigin(req({ host: 'admin.example.com', origin: 'https://evil.example.com' })),
    ).toThrow(CrossOriginError);
    expect(() => assertSameOrigin(req({ host: 'admin.example.com' }))).toThrow(CrossOriginError);
    expect(() =>
      assertSameOrigin(req({ host: 'admin.example.com', origin: 'not a url' })),
    ).toThrow(CrossOriginError);
  });
});
