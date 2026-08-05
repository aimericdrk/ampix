import { afterEach, describe, expect, it } from 'vitest';
import { getRuntimeConfig } from './config';

describe('getRuntimeConfig', () => {
  afterEach(() => {
    delete window.___MYAMPIX_CONFIG__;
  });

  it('returns values injected by config.js', () => {
    window.___MYAMPIX_CONFIG__ = {
      apiBaseUrl: 'https://api.myampix.example',
      purchaseApiBaseUrl: 'https://purchase.myampix.example',
    };
    expect(getRuntimeConfig()).toEqual({
      apiBaseUrl: 'https://api.myampix.example',
      purchaseApiBaseUrl: 'https://purchase.myampix.example',
    });
  });

  it('falls back to same-origin defaults when config.js is absent (dev)', () => {
    delete window.___MYAMPIX_CONFIG__;
    expect(getRuntimeConfig()).toEqual({ apiBaseUrl: '', purchaseApiBaseUrl: '' });
  });

  it('fills missing keys from defaults', () => {
    window.___MYAMPIX_CONFIG__ = { apiBaseUrl: 'https://api.myampix.example' };
    expect(getRuntimeConfig().apiBaseUrl).toBe('https://api.myampix.example');
    expect(getRuntimeConfig().purchaseApiBaseUrl).toBe('');
  });
});
