import type { Request } from 'express';
import type { User } from '@prisma/client';

/** Public-facing user shape (contracts §7/§11) — never includes passwordHash/totpSecret. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name };
}

/** Access-token payload. `purpose` pins this JWT to access-token use only. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  purpose: 'access';
}

/** mfa_token payload. `purpose` pins this JWT to the /2fa/verify exchange only. */
export interface MfaTokenPayload {
  sub: string;
  purpose: 'mfa';
}

/** Request shape after JwtAuthGuard has run — `user` is the decoded access-token identity. */
export interface AuthRequest extends Request {
  user?: PublicUser;
}
