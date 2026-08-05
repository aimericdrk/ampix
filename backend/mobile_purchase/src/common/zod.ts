import { z, ZodTypeAny } from 'zod';
import { ProblemException } from './problem-details';

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
      errors: parsed.error.issues,
    });
  }
  return parsed.data;
}
