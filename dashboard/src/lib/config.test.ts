import { afterEach, describe, expect, it } from 'vitest';
import { getRuntimeConfig } from './config';

describe('getRuntimeConfig', () => {
  afterEach(() => {
    delete window.___MYAMPIX_CONFIG__;
  });

  it('returns values injected by config.js', () => {
    window.___MYAMPIX_CONFIG__ = { apiBaseUrl: 'https://api.myampix.example' };
    expect(getRuntimeConfig()).toEqual({ apiBaseUrl: 'https://api.myampix.example' });
  });

  it('falls back to same-origin default when config.js is absent (dev)', () => {
    delete window.___MYAMPIX_CONFIG__;
    expect(getRuntimeConfig()).toEqual({ apiBaseUrl: '' });
  });

  it('fills missing keys from defaults', () => {
    window.___MYAMPIX_CONFIG__ = {};
    expect(getRuntimeConfig().apiBaseUrl).toBe('');
  });
});
