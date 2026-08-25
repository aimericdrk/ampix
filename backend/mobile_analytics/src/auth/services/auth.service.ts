import { Inject, Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import { generateSdkToken } from '../../common/sdk-token';
import { requireTotpEncKey } from './auth-config.util';
import { decodeEncryptionKey, decryptSecret, encryptSecret } from '../crypto/aes-gcm';
import { PasswordService } from '../crypto/password.service';
import { RecoveryCodeService } from '../two-factor/recovery-code.service';
import { RefreshTokenService } from '../tokens/refresh-token.service';
import { TokenService } from '../tokens/token.service';
import { TotpService } from '../two-factor/totp.service';
import { LoginDto, SignupDto } from '../schemas/auth.schemas';
import { PublicUser, toPublicUser } from '../auth.types';

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export interface MfaChallenge {
  mfaToken: string;
}

// A fixed, lazily-computed dummy hash — verified against on a "user not found" login so the
// response takes roughly the same time as a real password mismatch, denying an attacker a
// timing oracle for enumerating registered emails.
const DUMMY_PASSWORD_FOR_TIMING = 'dummy-password-for-timing-parity';

@Injectable()
export class AuthService {
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly totp: TotpService,
    private readonly recoveryCodes: RecoveryCodeService,
  ) {}

  /**
   * Creates the user and, in the SAME transaction (contracts §12), provisions their default
   * workspace: an Organization ("<name>'s Workspace"), an OWNER Membership linking the user to
   * it, a "Default" Project (UTC) with an owner ProjectMembership for that same user (per-project
   * access model — org membership alone no longer grants project access), and an ingest SdkToken
   * for that project. A brand-new account therefore always has exactly one org/project/token to
   * instrument against. The signup RESPONSE shape (access_token + user) is unchanged by this.
   *
   * The org Membership is `owner`, matching `OrgsService.create` (an org's creator owns it). It
   * used to be `admin`, written before the `owner` role existed; the 20260711102417 migration
   * backfilled orgs that predated the role but this code path was never updated, so every account
   * provisioned after that migration got an org with NO owner. That is a trap rather than a mere
   * downgrade: owner-only actions (deleting the org, transferring ownership) become permanently
   * unreachable, because promoting someone to owner itself requires an existing owner to hand it
   * over. Migration 20260824210000 repairs the orgs already created that way.
   */
  async signup(dto: SignupDto): Promise<Session> {
    const email = dto.email.toLowerCase();
    const passwordHash = await this.passwords.hash(dto.password);
    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email, passwordHash, name: dto.name } });
        const org = await tx.organization.create({ data: { name: `${dto.name}'s Workspace` } });
        await tx.membership.create({ data: { userId: created.id, orgId: org.id, role: 'owner' } });
        const project = await tx.project.create({
          data: { orgId: org.id, name: 'Default', timezone: 'UTC', createdById: created.id },
        });
        await tx.projectMembership.create({
          data: { userId: created.id, projectId: project.id, role: 'owner' },
        });
        await tx.sdkToken.create({
          data: { projectId: project.id, token: generateSdkToken(), label: 'default' },
        });
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw this.emailTaken();
      }
      throw err;
    }
    return this.issueSession(user);
  }

  async login(dto: LoginDto): Promise<Session | MfaChallenge> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Burn roughly the same time as a real mismatch would — see DUMMY_PASSWORD_FOR_TIMING.
      await this.passwords.verify(await this.dummyHash(), dto.password);
      throw this.invalidCredentials();
    }
    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw this.invalidCredentials();
    }
    if (user.twoFactorEnabled) {
      return { mfaToken: this.tokens.signMfaToken(user.id) };
    }
    return this.issueSession(user);
  }

  /** `/2fa/verify`: exchanges a validated mfa_token's userId + a TOTP/recovery code for a session. */
  async completeMfaLogin(userId: string, code: string): Promise<Session | null> {
    const user = await this.getUserById(userId);
    if (!user) return null;
    const valid = await this.verifyTotpOrRecovery(user, code);
    if (!valid) return null;
    return this.issueSession(user);
  }

  /** `/2fa/disable`: same code semantics (TOTP or recovery), but the user already has a session. */
  async verifyActiveCode(userId: string, code: string): Promise<boolean> {
    const user = await this.getUserById(userId);
    if (!user) return false;
    return this.verifyTotpOrRecovery(user, code);
  }

  async getUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** PATCH /api/v1/auth/me (contracts §13): renames the account, returns the public user shape. */
  async updateName(userId: string, name: string): Promise<PublicUser> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { name } });
    return toPublicUser(user);
  }

  /**
   * POST /api/v1/auth/password (contracts §13): verifies `currentPassword` against the stored
   * argon2id hash before re-hashing and persisting `newPassword`. Wrong current password -> 401,
   * distinguishing it from a plain validation error since it's an authentication check.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.getUserById(userId);
    if (!user) {
      throw this.wrongCurrentPassword();
    }
    const valid = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw this.wrongCurrentPassword();
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async isTwoFactorEnabled(userId: string): Promise<boolean> {
    const user = await this.getUserById(userId);
    return user?.twoFactorEnabled ?? false;
  }

  /** `/2fa/activate`: persists the pending secret (encrypted) and flips the account to 2FA-on. */
  async persistTotpSecret(userId: string, plainSecret: string): Promise<void> {
    const key = decodeEncryptionKey(requireTotpEncKey(this.config));
    const encrypted = encryptSecret(plainSecret, key);
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: encrypted, twoFactorEnabled: true },
    });
  }

  /** `/2fa/disable`: clears the secret, flips 2FA off, and deletes all recovery codes. */
  async disableTwoFactor(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, twoFactorEnabled: false },
    });
    await this.recoveryCodes.clearAll(userId);
  }

  private async verifyTotpOrRecovery(user: User, code: string): Promise<boolean> {
    if (!user.twoFactorEnabled || !user.totpSecret) return false;
    let totpOk = false;
    try {
      const key = decodeEncryptionKey(requireTotpEncKey(this.config));
      const secret = decryptSecret(user.totpSecret, key);
      totpOk = await this.totp.verify(code, secret);
    } catch {
      totpOk = false;
    }
    if (totpOk) return true;
    return this.recoveryCodes.consume(user.id, code);
  }

  private async issueSession(user: User): Promise<Session> {
    const publicUser = toPublicUser(user);
    const accessToken = this.tokens.signAccessToken(publicUser);
    const refreshToken = await this.refreshTokens.issue(user.id);
    return { accessToken, refreshToken, user: publicUser };
  }

  private async dummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = this.passwords.hash(DUMMY_PASSWORD_FOR_TIMING);
    }
    return this.dummyHashPromise;
  }

  private invalidCredentials(): ProblemException {
    return new ProblemException({
      status: 401,
      title: 'Unauthorized',
      detail: 'Invalid email or password',
    });
  }

  private wrongCurrentPassword(): ProblemException {
    return new ProblemException({
      status: 401,
      title: 'Unauthorized',
      detail: 'Current password is incorrect',
    });
  }

  private emailTaken(): ProblemException {
    return new ProblemException({
      status: 409,
      title: 'Conflict',
      detail: 'Email is already registered',
    });
  }
}
