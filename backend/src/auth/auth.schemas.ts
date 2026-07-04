import { z, ZodTypeAny } from 'zod';
import { ProblemException } from '../common/problem-details';

// Upper bounds are defense in depth against oversized-payload abuse (e.g. a ~1MB "code" being fed
// into the argon2 recovery-code verify loop, or a huge email/name being hashed/persisted) — chosen
// generously above any legitimate value: RFC 5321 caps an email address at 320 chars; TOTP codes
// are 6 digits and recovery codes are 24 chars (see recovery-code.service.ts), so 64 is ample
// headroom without being effectively unbounded.
const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const MAX_CODE_LENGTH = 64;

export const signupSchema = z.object({
  email: z.string().trim().min(1).max(MAX_EMAIL_LENGTH).email(),
  password: z.string().min(8, 'password must be at least 8 characters').max(MAX_PASSWORD_LENGTH),
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});
export type SignupDto = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().min(1).max(MAX_EMAIL_LENGTH).email(),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const verify2faSchema = z.object({
  mfa_token: z.string().min(1),
  code: z.string().min(1).max(MAX_CODE_LENGTH),
});
export type Verify2faDto = z.infer<typeof verify2faSchema>;

export const codeSchema = z.object({
  code: z.string().min(1).max(MAX_CODE_LENGTH),
});
export type CodeDto = z.infer<typeof codeSchema>;

// §13 — account (self) management.
export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});
export type UpdateMeDto = z.infer<typeof updateMeSchema>;

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  new_password: z
    .string()
    .min(8, 'new_password must be at least 8 characters')
    .max(MAX_PASSWORD_LENGTH),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

/** Parses `body` against `schema` or throws a 400 RFC 7807 problem naming the first bad field. */
export function parseOrThrow<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join('.') || 'body';
    throw new ProblemException({
      status: 400,
      title: 'Bad Request',
      detail: `${path}: ${issue.message}`,
    });
  }
  return parsed.data;
}
