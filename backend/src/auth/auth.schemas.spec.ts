import { ProblemException } from '../common/problem-details';
import {
  codeSchema,
  loginSchema,
  parseOrThrow,
  signupSchema,
  verify2faSchema,
} from './auth.schemas';

describe('auth.schemas', () => {
  describe('parseOrThrow', () => {
    it('returns the parsed data for a valid body', () => {
      const dto = parseOrThrow(loginSchema, { email: 'a@b.com', password: 'x' });
      expect(dto).toEqual({ email: 'a@b.com', password: 'x' });
    });

    it('throws a 400 ProblemException naming the first bad field', () => {
      expect(() => parseOrThrow(loginSchema, { email: 'not-an-email', password: 'x' })).toThrow(
        ProblemException,
      );
      try {
        parseOrThrow(loginSchema, { email: 'not-an-email', password: 'x' });
        fail('expected parseOrThrow to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ProblemException);
        expect((err as ProblemException).problem.status).toBe(400);
        expect((err as ProblemException).problem.detail).toContain('email');
      }
    });
  });

  describe('signupSchema', () => {
    it('accepts a valid signup body', () => {
      expect(
        signupSchema.safeParse({ email: 'a@b.com', password: 'password1', name: 'A' }).success,
      ).toBe(true);
    });

    it('rejects a password shorter than 8 characters', () => {
      const result = signupSchema.safeParse({ email: 'a@b.com', password: 'short', name: 'A' });
      expect(result.success).toBe(false);
    });

    it('rejects a missing name', () => {
      expect(signupSchema.safeParse({ email: 'a@b.com', password: 'password1' }).success).toBe(
        false,
      );
    });

    it('rejects an invalid email', () => {
      expect(
        signupSchema.safeParse({ email: 'not-an-email', password: 'password1', name: 'A' }).success,
      ).toBe(false);
    });
  });

  describe('verify2faSchema / codeSchema', () => {
    it('requires both mfa_token and code', () => {
      expect(verify2faSchema.safeParse({ mfa_token: 'x' }).success).toBe(false);
      expect(verify2faSchema.safeParse({ mfa_token: 'x', code: '123456' }).success).toBe(true);
    });

    it('codeSchema requires a non-empty code', () => {
      expect(codeSchema.safeParse({ code: '' }).success).toBe(false);
      expect(codeSchema.safeParse({ code: '123456' }).success).toBe(true);
    });
  });
});
