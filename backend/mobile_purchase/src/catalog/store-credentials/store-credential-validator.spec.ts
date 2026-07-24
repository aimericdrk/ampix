import { AppPlatform } from '../../../generated/client';
import type { StoreCredentialBlob } from './store-credential.types';
import type { StoreCredentialValidatorApp } from './store-credential-validator';
import {
  InMemoryStoreCredentialValidator,
  StoreApiCredentialValidator,
  StoreValidationUnavailableError,
  buildStoreCredentialValidator,
} from './store-credential-validator';

const ANDROID_APP: StoreCredentialValidatorApp = {
  platform: AppPlatform.ANDROID,
  bundleId: null,
  packageName: 'com.myampix.app',
};

const IOS_APP: StoreCredentialValidatorApp = {
  platform: AppPlatform.IOS,
  bundleId: 'com.myampix.app',
  packageName: null,
};

const GOOGLE_BLOB: StoreCredentialBlob = {
  kind: 'google_play',
  serviceAccountJson: '{"type":"service_account"}',
};

const APPLE_BLOB: StoreCredentialBlob = {
  kind: 'app_store',
  ascIssuerId: '69a6de70-1234-47e3-e053-5b8c7c11a4d1',
  ascKeyId: 'ABC1234DEF',
  ascPrivateKeyP8: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n',
  appAppleId: '1234567890',
};

describe('InMemoryStoreCredentialValidator', () => {
  it('resolves { liveVerified: true } by default and records the call', async () => {
    const validator = new InMemoryStoreCredentialValidator();

    await expect(validator.validate(ANDROID_APP, GOOGLE_BLOB)).resolves.toEqual({ liveVerified: true });
    expect(validator.validateCalls).toEqual([{ app: ANDROID_APP, blob: GOOGLE_BLOB }]);
  });

  it('resolves { liveVerified: false } when configured', async () => {
    const validator = new InMemoryStoreCredentialValidator().resolveWith(false);

    await expect(validator.validate(IOS_APP, APPLE_BLOB)).resolves.toEqual({ liveVerified: false });
  });

  it('throws StoreValidationUnavailableError when configured, still recording the call', async () => {
    const validator = new InMemoryStoreCredentialValidator().failWith(
      new StoreValidationUnavailableError('validation unavailable'),
    );

    await expect(validator.validate(ANDROID_APP, GOOGLE_BLOB)).rejects.toBeInstanceOf(StoreValidationUnavailableError);
    expect(validator.validateCalls).toEqual([{ app: ANDROID_APP, blob: GOOGLE_BLOB }]);
  });

  it('throws a generic store error when configured (the 502 "store rejected" branch)', async () => {
    const storeError = new Error('store rejected the credentials');
    const validator = new InMemoryStoreCredentialValidator().failWith(storeError);

    await expect(validator.validate(ANDROID_APP, GOOGLE_BLOB)).rejects.toBe(storeError);
  });
});

describe('StoreApiCredentialValidator (creds-gated real impl)', () => {
  it('throws StoreValidationUnavailableError for a Google Play credential', async () => {
    const validator = new StoreApiCredentialValidator();

    await expect(validator.validate(ANDROID_APP, GOOGLE_BLOB)).rejects.toBeInstanceOf(StoreValidationUnavailableError);
  });

  it('throws StoreValidationUnavailableError for an App Store credential', async () => {
    const validator = new StoreApiCredentialValidator();

    await expect(validator.validate(IOS_APP, APPLE_BLOB)).rejects.toBeInstanceOf(StoreValidationUnavailableError);
  });
});

describe('buildStoreCredentialValidator', () => {
  it('builds the real creds-gated validator', async () => {
    const validator = buildStoreCredentialValidator();

    expect(validator).toBeInstanceOf(StoreApiCredentialValidator);
    await expect(validator.validate(ANDROID_APP, GOOGLE_BLOB)).rejects.toBeInstanceOf(StoreValidationUnavailableError);
  });
});
