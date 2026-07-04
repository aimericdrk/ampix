import { authenticator } from 'otplib';
import type Redis from 'ioredis';
import { AppConfig } from '../config/app-config';
import { TotpService } from './totp.service';
import { makeAuthTestConfig as baseConfig } from './test-support/config.fixture';

class FakeRedis {
  store = new Map<string, string>();
  ttls = new Map<string, number>();
  async set(key: string, value: string, _ex: string, ttl: number): Promise<'OK'> {
    this.store.set(key, value);
    this.ttls.set(key, ttl);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

describe('TotpService', () => {
  function makeService(configOverrides: Partial<AppConfig> = {}) {
    const redis = new FakeRedis();
    const totp = new TotpService(baseConfig(configOverrides), redis as unknown as Redis);
    return { totp, redis };
  }

  it('generates a base32 secret', () => {
    const { totp } = makeService();
    const secret = totp.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(secret.length).toBeGreaterThan(10);
  });

  it('builds an otpauth:// keyuri carrying the issuer and email', () => {
    const { totp } = makeService();
    const uri = totp.keyUri('user@example.com', 'JBSWY3DPEHPK3PXP');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('MyAmpMix');
    expect(decodeURIComponent(uri)).toContain('user@example.com');
  });

  it('renders a PNG data URI for the QR code', async () => {
    const { totp } = makeService();
    const uri = totp.keyUri('user@example.com', 'JBSWY3DPEHPK3PXP');
    const dataUrl = await totp.qrDataUrl(uri);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('verifies a code generated for the same secret (RFC 6238)', async () => {
    const { totp } = makeService();
    const secret = authenticator.generateSecret();
    const code = authenticator.generate(secret);
    await expect(totp.verify(code, secret)).resolves.toBe(true);
  });

  it('rejects a wrong code', async () => {
    const { totp } = makeService();
    const secret = authenticator.generateSecret();
    await expect(totp.verify('000000', secret)).resolves.toBe(false);
  });

  it('never throws on a malformed secret — resolves false instead', async () => {
    const { totp } = makeService();
    await expect(totp.verify('123456', 'not-a-valid-base32-secret!!')).resolves.toBe(false);
  });

  it('stores, reads, and clears a pending secret in Redis with a TTL', async () => {
    const { totp, redis } = makeService();
    await totp.storePending('user-1', 'SECRET123');
    expect(redis.store.get('2fa:pending:user-1')).toBe('SECRET123');
    expect(redis.ttls.get('2fa:pending:user-1')).toBe(10 * 60);
    await expect(totp.getPending('user-1')).resolves.toBe('SECRET123');
    await totp.clearPending('user-1');
    await expect(totp.getPending('user-1')).resolves.toBeNull();
  });

  it('getPending returns null when nothing is pending', async () => {
    const { totp } = makeService();
    await expect(totp.getPending('nobody')).resolves.toBeNull();
  });
});
