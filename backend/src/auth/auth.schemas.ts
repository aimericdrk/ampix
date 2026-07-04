import { z, ZodTypeAny } from 'zod';
import { ProblemException } from '../common/problem-details';

export const signupSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(8, 'password must be at least 8 characters'),
  name: z.string().trim().min(1),
});
export type SignupDto = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const verify2faSchema = z.object({
  mfa_token: z.string().min(1),
  code: z.string().min(1),
});
export type Verify2faDto = z.infer<typeof verify2faSchema>;

export const codeSchema = z.object({
  code: z.string().min(1),
});
export type CodeDto = z.infer<typeof codeSchema>;

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
