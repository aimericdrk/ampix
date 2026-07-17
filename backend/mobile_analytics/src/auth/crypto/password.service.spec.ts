import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('round-trips a password through hash/verify', async () => {
    const hash = await passwords.hash('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
    await expect(passwords.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('produces an argon2id hash', async () => {
    const hash = await passwords.hash('some-password');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('rejects the wrong password', async () => {
    const hash = await passwords.hash('right-password');
    await expect(passwords.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('never throws on a malformed/foreign hash — returns false instead', async () => {
    await expect(passwords.verify('not-a-real-hash', 'anything')).resolves.toBe(false);
  });

  it('salts each hash differently', async () => {
    const a = await passwords.hash('same-password');
    const b = await passwords.hash('same-password');
    expect(a).not.toBe(b);
  });
});
