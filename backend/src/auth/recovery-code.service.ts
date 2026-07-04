import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';

export const RECOVERY_CODE_COUNT = 10;

/** Formats 10 random bytes as 5 dash-separated groups of 4 hex chars, e.g. "a1b2-c3d4-...". */
function generateCode(): string {
  const raw = randomBytes(10).toString('hex'); // 20 hex chars
  return raw.match(/.{1,4}/g)!.join('-');
}

/**
 * 10 single-use 2FA recovery codes (contracts §11). Only argon2id hashes are ever persisted
 * (`two_factor_recovery_codes.code_hash`); plaintext is returned to the caller exactly once, at
 * generation time, and never stored or logged.
 */
@Injectable()
export class RecoveryCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  /** Generates `RECOVERY_CODE_COUNT` fresh codes for `userId` and persists their hashes. Does
   *  NOT clear any pre-existing codes — callers that re-generate must clear first themselves. */
  async generateAndStore(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateCode());
    const rows = await Promise.all(
      codes.map(async (code) => ({ userId, codeHash: await this.passwords.hash(code) })),
    );
    await this.prisma.twoFactorRecoveryCode.createMany({ data: rows });
    return codes;
  }

  /**
   * Checks `code` against every unused recovery code hash for `userId`. On a match, atomically
   * marks that row used (guarded by `usedAt: null` so a concurrent double-submit of the same
   * valid code can only succeed once) and returns true. Returns false if nothing matches.
   */
  async consume(userId: string, code: string): Promise<boolean> {
    const candidates = await this.prisma.twoFactorRecoveryCode.findMany({
      where: { userId, usedAt: null },
    });
    for (const candidate of candidates) {
      if (await this.passwords.verify(candidate.codeHash, code)) {
        const result = await this.prisma.twoFactorRecoveryCode.updateMany({
          where: { id: candidate.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (result.count === 1) return true;
      }
    }
    return false;
  }

  async clearAll(userId: string): Promise<void> {
    await this.prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } });
  }
}
