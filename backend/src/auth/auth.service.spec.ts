import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import { authenticator } from 'otplib';
import type Redis from 'ioredis';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { decodeEncryptionKey, encryptSecret } from './crypto/aes-gcm';
import { PasswordService } from './password.service';
import { RecoveryCodeService } from './recovery-code.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';
import { makeAuthTestConfig } from './test-support/config.fixture';

let nextId = 0;
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: `018f6b2e-0000-7000-8000-00000000000${nextId++}`,
    email: 'user@example.com',
    passwordHash: '',
    name: 'A User',
    totpSecret: null,
    twoFactorEnabled: false,
    createdAt: new Date(),
    ...overrides,
  };
}

class FakePrisma {
  users: User[] = [];
  organizations: { id: string; name: string }[] = [];
  memberships: { userId: string; orgId: string; role: string }[] = [];
  projects: { id: string; orgId: string; name: string; timezone: string; createdById?: string }[] =
    [];
  projectMemberships: { userId: string; projectId: string; role: string }[] = [];
  sdkTokens: { id: string; projectId: string; token: string; label: string; revokedAt: null }[] =
    [];
  refreshTokens: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
  }[] = [];
  private nextRefreshId = 0;
  private nextOrgId = 0;
  private nextProjectId = 0;
  private nextSdkTokenId = 0;

  user = {
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email !== undefined) return this.users.find((u) => u.email === where.email) ?? null;
      if (where.id !== undefined) return this.users.find((u) => u.id === where.id) ?? null;
      return null;
    },
    create: async ({ data }: { data: { email: string; passwordHash: string; name: string } }) => {
      if (this.users.some((u) => u.email === data.email)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on: email', {
          code: 'P2002',
          clientVersion: '6.19.3',
        });
      }
      const user = makeUser(data);
      this.users.push(user);
      return user;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
      const user = this.users.find((u) => u.id === where.id);
      if (!user) throw new Error('not found');
      Object.assign(user, data);
      return user;
    },
  };

  organization = {
    create: async ({ data }: { data: { name: string } }) => {
      const org = { id: `org-${this.nextOrgId++}`, ...data };
      this.organizations.push(org);
      return org;
    },
  };

  membership = {
    create: async ({ data }: { data: { userId: string; orgId: string; role: string } }) => {
      this.memberships.push({ ...data });
      return data;
    },
  };

  project = {
    create: async ({
      data,
    }: {
      data: { orgId: string; name: string; timezone: string; createdById?: string };
    }) => {
      const project = { id: `project-${this.nextProjectId++}`, ...data };
      this.projects.push(project);
      return project;
    },
  };

  projectMembership = {
    create: async ({ data }: { data: { userId: string; projectId: string; role: string } }) => {
      this.projectMemberships.push({ ...data });
      return data;
    },
  };

  sdkToken = {
    create: async ({ data }: { data: { projectId: string; token: string; label: string } }) => {
      const token = { id: `sdk-${this.nextSdkTokenId++}`, revokedAt: null, ...data };
      this.sdkTokens.push(token);
      return token;
    },
  };

  refreshToken = {
    create: async ({ data }: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
      const row = { id: `rt-${this.nextRefreshId++}`, revokedAt: null, ...data };
      this.refreshTokens.push(row);
      return row;
    },
  };

  /** Mimics Prisma's interactive transaction: runs the callback against this same fake client
   *  (no real atomicity, but sufficient for unit-testing the sequence of calls signup makes). */
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

describe('AuthService', () => {
  function makeService() {
    const prisma = new FakePrisma();
    const config = makeAuthTestConfig();
    const passwords = new PasswordService();
    const tokens = new TokenService(new JwtService(), config);
    const refreshTokens = new RefreshTokenService(prisma as unknown as PrismaService, config);
    const fakeRedis = { get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as Redis;
    const totp = new TotpService(config, fakeRedis);
    const recoveryCodes = {
      consume: jest.fn().mockResolvedValue(false),
      clearAll: jest.fn().mockResolvedValue(undefined),
      generateAndStore: jest.fn().mockResolvedValue([]),
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      config,
      passwords,
      tokens,
      refreshTokens,
      totp,
      recoveryCodes as unknown as RecoveryCodeService,
    );
    return { service, prisma, config, passwords, tokens, totp, recoveryCodes };
  }

  describe('signup', () => {
    it('creates a user and issues a session', async () => {
      const { service, prisma } = makeService();
      const session = await service.signup({
        email: 'New@Example.com',
        password: 'password1',
        name: 'New',
      });

      expect(session.user.email).toBe('new@example.com'); // normalized to lowercase
      expect(session.accessToken).toEqual(expect.any(String));
      expect(session.refreshToken).toEqual(expect.any(String));
      expect(prisma.users).toHaveLength(1);
      expect(prisma.users[0].passwordHash).not.toBe('password1');
    });

    it('provisions a default workspace (org, admin membership, Default project + owner ProjectMembership, sdk token) — contracts §12', async () => {
      const { service, prisma } = makeService();
      const session = await service.signup({
        email: 'workspace@example.com',
        password: 'password1',
        name: 'Ada',
      });

      expect(prisma.organizations).toHaveLength(1);
      expect(prisma.organizations[0].name).toBe("Ada's Workspace");

      expect(prisma.memberships).toEqual([
        { userId: session.user.id, orgId: prisma.organizations[0].id, role: 'admin' },
      ]);

      expect(prisma.projects).toHaveLength(1);
      expect(prisma.projects[0]).toMatchObject({
        orgId: prisma.organizations[0].id,
        name: 'Default',
        timezone: 'UTC',
        createdById: session.user.id,
      });

      // Per-project access model: org membership alone no longer grants project access, so the
      // creator must also get an owner ProjectMembership — otherwise they'd be locked out of the
      // very project signup just created for them.
      expect(prisma.projectMemberships).toEqual([
        { userId: session.user.id, projectId: prisma.projects[0].id, role: 'owner' },
      ]);

      expect(prisma.sdkTokens).toHaveLength(1);
      expect(prisma.sdkTokens[0]).toMatchObject({
        projectId: prisma.projects[0].id,
        label: 'default',
        revokedAt: null,
      });
      expect(prisma.sdkTokens[0].token).toMatch(/^mam_[0-9a-f]{32}$/);

      // The signup RESPONSE shape is unchanged by workspace provisioning.
      expect(Object.keys(session).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
    });

    it('throws 409 on a duplicate email', async () => {
      const { service } = makeService();
      await service.signup({ email: 'dup@example.com', password: 'password1', name: 'A' });
      await expect(
        service.signup({ email: 'dup@example.com', password: 'password2', name: 'B' }),
      ).rejects.toMatchObject({ problem: { status: 409 } });
    });

    it('treats email comparison case-insensitively for the duplicate check', async () => {
      const { service } = makeService();
      await service.signup({ email: 'case@example.com', password: 'password1', name: 'A' });
      await expect(
        service.signup({ email: 'CASE@example.com', password: 'password2', name: 'B' }),
      ).rejects.toMatchObject({ problem: { status: 409 } });
    });
  });

  describe('login', () => {
    it('issues a session for correct credentials with 2FA off', async () => {
      const { service, passwords, prisma } = makeService();
      prisma.users.push(
        makeUser({ email: 'x@y.com', passwordHash: await passwords.hash('secret123') }),
      );

      const result = await service.login({ email: 'x@y.com', password: 'secret123' });
      expect('accessToken' in result).toBe(true);
    });

    it('returns an mfa challenge (no tokens) when 2FA is on', async () => {
      const { service, passwords, prisma } = makeService();
      prisma.users.push(
        makeUser({
          email: 'mfa@y.com',
          passwordHash: await passwords.hash('secret123'),
          twoFactorEnabled: true,
        }),
      );

      const result = await service.login({ email: 'mfa@y.com', password: 'secret123' });
      expect(result).toHaveProperty('mfaToken');
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('rejects a wrong password with 401', async () => {
      const { service, passwords, prisma } = makeService();
      prisma.users.push(
        makeUser({ email: 'x@y.com', passwordHash: await passwords.hash('secret123') }),
      );

      await expect(service.login({ email: 'x@y.com', password: 'wrong' })).rejects.toMatchObject({
        problem: { status: 401 },
      });
    });

    it('rejects an unknown email with 401 (not 404 — avoids confirming account existence)', async () => {
      const { service } = makeService();
      await expect(
        service.login({ email: 'nobody@y.com', password: 'whatever' }),
      ).rejects.toMatchObject({ problem: { status: 401 } });
    });
  });

  describe('completeMfaLogin', () => {
    it('issues a session for a valid TOTP code', async () => {
      const { service, prisma, config } = makeService();
      const secret = authenticator.generateSecret();
      const key = decodeEncryptionKey(config.auth!.totpEncKey!);
      const user = makeUser({ twoFactorEnabled: true, totpSecret: encryptSecret(secret, key) });
      prisma.users.push(user);
      const code = authenticator.generate(secret);

      const session = await service.completeMfaLogin(user.id, code);
      expect(session).not.toBeNull();
      expect(session!.user.id).toBe(user.id);
    });

    it('falls back to a recovery code when the TOTP code is wrong', async () => {
      const { service, prisma, config, recoveryCodes } = makeService();
      const secret = authenticator.generateSecret();
      const key = decodeEncryptionKey(config.auth!.totpEncKey!);
      const user = makeUser({ twoFactorEnabled: true, totpSecret: encryptSecret(secret, key) });
      prisma.users.push(user);
      recoveryCodes.consume.mockResolvedValueOnce(true);

      const session = await service.completeMfaLogin(user.id, 'a-recovery-code');
      expect(session).not.toBeNull();
      expect(recoveryCodes.consume).toHaveBeenCalledWith(user.id, 'a-recovery-code');
    });

    it('returns null for an invalid code', async () => {
      const { service, prisma, config } = makeService();
      const secret = authenticator.generateSecret();
      const key = decodeEncryptionKey(config.auth!.totpEncKey!);
      const user = makeUser({ twoFactorEnabled: true, totpSecret: encryptSecret(secret, key) });
      prisma.users.push(user);

      await expect(service.completeMfaLogin(user.id, '000000')).resolves.toBeNull();
    });

    it('returns null when the user has 2FA disabled (edge case: race with /2fa/disable)', async () => {
      const { service, prisma } = makeService();
      const user = makeUser({ twoFactorEnabled: false });
      prisma.users.push(user);

      await expect(service.completeMfaLogin(user.id, '123456')).resolves.toBeNull();
    });

    it('returns null for an unknown user id', async () => {
      const { service } = makeService();
      await expect(service.completeMfaLogin('nonexistent', '123456')).resolves.toBeNull();
    });
  });

  describe('verifyActiveCode (used by /2fa/disable)', () => {
    it('accepts a valid TOTP code', async () => {
      const { service, prisma, config } = makeService();
      const secret = authenticator.generateSecret();
      const key = decodeEncryptionKey(config.auth!.totpEncKey!);
      const user = makeUser({ twoFactorEnabled: true, totpSecret: encryptSecret(secret, key) });
      prisma.users.push(user);
      const code = authenticator.generate(secret);

      await expect(service.verifyActiveCode(user.id, code)).resolves.toBe(true);
    });

    it('rejects an invalid code', async () => {
      const { service, prisma, config } = makeService();
      const secret = authenticator.generateSecret();
      const key = decodeEncryptionKey(config.auth!.totpEncKey!);
      const user = makeUser({ twoFactorEnabled: true, totpSecret: encryptSecret(secret, key) });
      prisma.users.push(user);

      await expect(service.verifyActiveCode(user.id, '000000')).resolves.toBe(false);
    });

    it('returns false for an unknown user', async () => {
      const { service } = makeService();
      await expect(service.verifyActiveCode('nonexistent', '123456')).resolves.toBe(false);
    });
  });

  describe('persistTotpSecret / disableTwoFactor', () => {
    it('encrypts the secret at rest and flips twoFactorEnabled on', async () => {
      const { service, prisma } = makeService();
      const user = makeUser();
      prisma.users.push(user);

      await service.persistTotpSecret(user.id, 'JBSWY3DPEHPK3PXP');

      expect(prisma.users[0].twoFactorEnabled).toBe(true);
      expect(prisma.users[0].totpSecret).not.toBe('JBSWY3DPEHPK3PXP');
      expect(prisma.users[0].totpSecret!.split('.')).toHaveLength(3); // iv.tag.ciphertext
    });

    it('clears the secret, flips twoFactorEnabled off, and deletes recovery codes', async () => {
      const { service, prisma, recoveryCodes } = makeService();
      const user = makeUser({ twoFactorEnabled: true, totpSecret: 'iv.tag.ct' });
      prisma.users.push(user);

      await service.disableTwoFactor(user.id);

      expect(prisma.users[0].twoFactorEnabled).toBe(false);
      expect(prisma.users[0].totpSecret).toBeNull();
      expect(recoveryCodes.clearAll).toHaveBeenCalledWith(user.id);
    });
  });

  describe('getUserById / isTwoFactorEnabled', () => {
    it('returns the user or null', async () => {
      const { service, prisma } = makeService();
      const user = makeUser();
      prisma.users.push(user);
      await expect(service.getUserById(user.id)).resolves.toEqual(user);
      await expect(service.getUserById('missing')).resolves.toBeNull();
    });

    it('reports two-factor status, defaulting to false for an unknown user', async () => {
      const { service, prisma } = makeService();
      const user = makeUser({ twoFactorEnabled: true });
      prisma.users.push(user);
      await expect(service.isTwoFactorEnabled(user.id)).resolves.toBe(true);
      await expect(service.isTwoFactorEnabled('missing')).resolves.toBe(false);
    });
  });

  describe('updateName (contracts §13 PATCH /auth/me)', () => {
    it('renames the account and returns the public user shape', async () => {
      const { service, prisma } = makeService();
      const user = makeUser({ name: 'Old Name' });
      prisma.users.push(user);

      const updated = await service.updateName(user.id, 'New Name');

      expect(updated).toEqual({ id: user.id, email: user.email, name: 'New Name' });
      expect(prisma.users[0].name).toBe('New Name');
    });
  });

  describe('changePassword (contracts §13 POST /auth/password)', () => {
    it('verifies the current password, re-hashes, and persists the new one', async () => {
      const { service, prisma, passwords } = makeService();
      const originalHash = await passwords.hash('old-password1');
      const user = makeUser({ passwordHash: originalHash });
      prisma.users.push(user);

      await service.changePassword(user.id, 'old-password1', 'new-password1');

      expect(prisma.users[0].passwordHash).not.toBe(originalHash);
      expect(await passwords.verify(prisma.users[0].passwordHash, 'new-password1')).toBe(true);
    });

    it('rejects with 401 when the current password is wrong, and does not change anything', async () => {
      const { service, prisma, passwords } = makeService();
      const originalHash = await passwords.hash('old-password1');
      const user = makeUser({ passwordHash: originalHash });
      prisma.users.push(user);

      await expect(
        service.changePassword(user.id, 'wrong-password', 'new-password1'),
      ).rejects.toMatchObject({ problem: { status: 401 } });
      expect(prisma.users[0].passwordHash).toBe(originalHash);
    });

    it('rejects with 401 for an unknown user id', async () => {
      const { service } = makeService();
      await expect(
        service.changePassword('nonexistent', 'whatever', 'new-password1'),
      ).rejects.toMatchObject({ problem: { status: 401 } });
    });
  });

  it('re-throws unexpected prisma errors from signup (not P2002)', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(prisma.user, 'create').mockRejectedValueOnce(new Error('connection refused'));
    await expect(
      service.signup({ email: 'boom@example.com', password: 'password1', name: 'A' }),
    ).rejects.toThrow('connection refused');
  });
});
