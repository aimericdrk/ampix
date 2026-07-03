import { describe, expect, it } from 'vitest';
import { validateLogin, validateSignup } from './validation';

describe('validateLogin', () => {
  it('requires email and password', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'Email is required',
      password: 'Password is required',
    });
  });

  it('rejects malformed emails', () => {
    expect(validateLogin({ email: 'not-an-email', password: 'x' })).toEqual({
      email: 'Enter a valid email address',
    });
  });

  it('passes valid input', () => {
    expect(validateLogin({ email: 'ada@example.com', password: 'correct-horse-9' })).toEqual({});
  });
});

describe('validateSignup', () => {
  it('requires name and a password of at least 8 characters', () => {
    expect(validateSignup({ name: '  ', email: 'ada@example.com', password: 'short' })).toEqual({
      name: 'Name is required',
      password: 'Password must be at least 8 characters',
    });
  });

  it('passes valid input', () => {
    expect(
      validateSignup({ name: 'Ada', email: 'ada@example.com', password: 'correct-horse-9' }),
    ).toEqual({});
  });
});
