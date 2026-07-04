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

    it('rejects an email over 320 characters', () => {
      const boundaryEmail = `${'a'.repeat(314)}@b.com`; // exactly 320 chars — at the boundary
      expect(
        signupSchema.safeParse({ email: boundaryEmail, password: 'password1', name: 'A' }).success,
      ).toBe(true);
      const tooHugeEmail = `${'a'.repeat(315)}@b.com`; // 321 chars — one over the bound
      expect(
        signupSchema.safeParse({ email: tooHugeEmail, password: 'password1', name: 'A' }).success,
      ).toBe(false);
    });

    it('rejects a password over 200 characters', () => {
      expect(
        signupSchema.safeParse({ email: 'a@b.com', password: 'p'.repeat(200), name: 'A' }).success,
      ).toBe(true);
      expect(
        signupSchema.safeParse({ email: 'a@b.com', password: 'p'.repeat(201), name: 'A' }).success,
      ).toBe(false);
    });

    it('rejects a name over 200 characters', () => {
      expect(
        signupSchema.safeParse({ email: 'a@b.com', password: 'password1', name: 'n'.repeat(200) })
          .success,
      ).toBe(true);
      expect(
        signupSchema.safeParse({ email: 'a@b.com', password: 'password1', name: 'n'.repeat(201) })
          .success,
      ).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('rejects a password over 200 characters', () => {
      expect(loginSchema.safeParse({ email: 'a@b.com', password: 'p'.repeat(201) }).success).toBe(
        false,
      );
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

    it('codeSchema rejects a code over 64 characters (before it could ever reach argon2)', () => {
      expect(codeSchema.safeParse({ code: 'a'.repeat(64) }).success).toBe(true);
      expect(codeSchema.safeParse({ code: 'a'.repeat(65) }).success).toBe(false);
    });

    it('parseOrThrow rejects a ~1MB code with a 400, naming the field, without ever computing an argon2 hash', () => {
      const hugeCode = 'a'.repeat(1_000_000);
      expect(() => parseOrThrow(codeSchema, { code: hugeCode })).toThrow(ProblemException);
      try {
        parseOrThrow(codeSchema, { code: hugeCode });
        fail('expected parseOrThrow to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ProblemException);
        expect((err as ProblemException).problem.status).toBe(400);
        expect((err as ProblemException).problem.detail).toContain('code');
      }
    });

    it('verify2faSchema rejects a code over 64 characters', () => {
      expect(verify2faSchema.safeParse({ mfa_token: 'x', code: 'a'.repeat(65) }).success).toBe(
        false,
      );
    });
  });
});
