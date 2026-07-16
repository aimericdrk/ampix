import { generatePublicSdkKey } from './key-generator';

describe('generatePublicSdkKey', () => {
  it('starts with the public prefix and is unique', () => {
    const a = generatePublicSdkKey();
    const b = generatePublicSdkKey();
    expect(a).toMatch(/^mrc_pub_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
