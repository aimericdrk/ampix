import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAppleRootCertificates } from './apple-root-certs';

describe('loadAppleRootCertificates', () => {
  it('returns [] for a missing directory', () => {
    expect(loadAppleRootCertificates('/definitely/does/not/exist/certs')).toEqual([]);
  });

  it('returns [] for an existing but empty directory (README.md-only placeholder)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apple-certs-empty-'));
    try {
      writeFileSync(join(dir, 'README.md'), '# placeholder\n');
      expect(loadAppleRootCertificates(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads every non-ignored regular file as a Buffer, skipping README.md and dotfiles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apple-certs-'));
    try {
      writeFileSync(join(dir, 'README.md'), '# placeholder\n');
      writeFileSync(join(dir, '.gitkeep'), '');
      writeFileSync(join(dir, 'root-ca-g3.pem'), '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n');

      const certs = loadAppleRootCertificates(dir);

      expect(certs).toHaveLength(1);
      expect(Buffer.isBuffer(certs[0])).toBe(true);
      expect(certs[0].toString()).toContain('BEGIN CERTIFICATE');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
