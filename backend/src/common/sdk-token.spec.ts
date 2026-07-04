import { SDK_TOKEN_REGEX } from '@myampmix/contracts';
import { generateSdkToken } from './sdk-token';

describe('generateSdkToken', () => {
  it('matches the mam_ + 32 lowercase hex format', () => {
    expect(generateSdkToken()).toMatch(SDK_TOKEN_REGEX);
  });

  it('generates unique tokens', () => {
    const a = generateSdkToken();
    const b = generateSdkToken();
    expect(a).not.toBe(b);
  });
});
