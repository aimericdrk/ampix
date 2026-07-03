import { afterEach, describe, expect, it } from 'vitest';
import { getRuntimeConfig } from './config';

describe('getRuntimeConfig', () => {
  afterEach(() => {
    delete window.__MYAMPMIX_CONFIG__;
  });

  it('returns values injected by config.js', () => {
    window.__MYAMPMIX_CONFIG__ = { apiBaseUrl: 'https://api.myampmix.example' };
    expect(getRuntimeConfig()).toEqual({ apiBaseUrl: 'https://api.myampmix.example' });
  });

  it('falls back to same-origin default when config.js is absent (dev)', () => {
    delete window.__MYAMPMIX_CONFIG__;
    expect(getRuntimeConfig()).toEqual({ apiBaseUrl: '' });
  });

  it('fills missing keys from defaults', () => {
    window.__MYAMPMIX_CONFIG__ = {};
    expect(getRuntimeConfig().apiBaseUrl).toBe('');
  });
});
