import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Password hashing (argon2id, contracts §11) and single-use recovery-code hashing. */
@Injectable()
export class PasswordService {
  async hash(secret: string): Promise<string> {
    return argon2.hash(secret, { type: argon2.argon2id });
  }

  /** Never throws on a malformed/foreign hash — treats it as "does not match". */
  async verify(hash: string, secret: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, secret);
    } catch {
      return false;
    }
  }
}
