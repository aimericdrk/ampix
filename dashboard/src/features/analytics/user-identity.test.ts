import { describe, expect, it } from 'vitest';
import {
  contactFromListItem,
  contactLine,
  profileAge,
  profileCity,
  profileEmail,
  profileName,
  profilePhone,
} from './user-identity';

describe('user-identity', () => {
  describe('contactLine', () => {
    it('prefers the email address', () => {
      expect(contactLine({ email: 'ada@example.com', phone: '+44 20 7946 0958' }, 'u1')).toBe(
        'ada@example.com',
      );
    });

    it('falls back to the phone number when there is no email', () => {
      expect(contactLine({ phone: '+44 20 7946 0958' }, 'u1')).toBe('+44 20 7946 0958');
    });

    it('falls back to the distinct id when the profile has neither', () => {
      expect(contactLine({ plan: 'pro' }, 'u1')).toBe('u1');
      expect(contactLine(undefined, 'u1')).toBe('u1');
    });

    it('treats an empty or whitespace-only value as absent', () => {
      expect(contactLine({ email: '', phone: '   ' }, 'u1')).toBe('u1');
    });
  });

  describe('contactFromListItem', () => {
    it('applies the same email → phone → id fallback to a users-list row', () => {
      const base = { distinct_id: 'u1' };
      expect(contactFromListItem({ ...base, email: 'ada@example.com', phone: '+44' })).toBe(
        'ada@example.com',
      );
      expect(contactFromListItem({ ...base, email: null, phone: '+44' })).toBe('+44');
      expect(contactFromListItem({ ...base, email: null, phone: null })).toBe('u1');
    });
  });

  describe('field readers', () => {
    it('accepts the conventional spellings in priority order', () => {
      expect(profileName({ $name: 'From $name' })).toBe('From $name');
      expect(profileName({ name: 'From name', $name: 'From $name' })).toBe('From name');
      expect(profileEmail({ $email: 'ada@example.com' })).toBe('ada@example.com');
      expect(profilePhone({ phone_number: '+33 1' })).toBe('+33 1');
      expect(profilePhone({ phoneNumber: '+33 2' })).toBe('+33 2');
      expect(profileCity({ $city: 'Paris' })).toBe('Paris');
    });

    it('returns null when no accepted key is set', () => {
      expect(profileName({ plan: 'pro' })).toBeNull();
      expect(profileCity(undefined)).toBeNull();
    });

    it('stringifies and trims non-string values', () => {
      expect(profileCity({ city: '  Paris  ' })).toBe('Paris');
      expect(profileName({ name: 42 })).toBe('42');
    });
  });

  describe('profileAge', () => {
    it('accepts a number or a numeric string', () => {
      expect(profileAge({ age: 36 })).toBe('36');
      expect(profileAge({ age: '36' })).toBe('36');
    });

    it('rejects values that cannot be a human age rather than rendering them', () => {
      expect(profileAge({ age: 'thirty-six' })).toBeNull();
      expect(profileAge({ age: -1 })).toBeNull();
      expect(profileAge({ age: 999 })).toBeNull();
    });

    it('is null when unset', () => {
      expect(profileAge({ plan: 'pro' })).toBeNull();
    });
  });
});
