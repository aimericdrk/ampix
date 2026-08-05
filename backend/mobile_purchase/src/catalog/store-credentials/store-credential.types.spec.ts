import { AppPlatform } from '../../../generated/client';
import { ProblemException } from '../../common/problem-details';
import { parseStoreCredentialBlob } from './store-credential.types';

const VALID_SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'my-project',
  client_email: 'sa@my-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n',
});

const VALID_GOOGLE_BLOB = {
  kind: 'google_play',
  serviceAccountJson: VALID_SERVICE_ACCOUNT_JSON,
};

const VALID_APPLE_BLOB = {
  kind: 'app_store',
  ascIssuerId: '69a6de70-1234-47e3-e053-5b8c7c11a4d1',
  ascKeyId: 'ABC1234DEF',
  ascPrivateKeyP8: '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG...\n-----END PRIVATE KEY-----\n',
  appAppleId: '1234567890',
};

function expectProblemStatus(fn: () => unknown, status: number): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ProblemException);
    expect((err as ProblemException).problem.status).toBe(status);
    return;
  }
  throw new Error(`expected parseStoreCredentialBlob to throw a ProblemException ${status}`);
}

describe('parseStoreCredentialBlob', () => {
  describe('happy path', () => {
    it('parses a valid Google Play blob for ANDROID', () => {
      expect(parseStoreCredentialBlob(AppPlatform.ANDROID, VALID_GOOGLE_BLOB)).toEqual({
        kind: 'google_play',
        serviceAccountJson: VALID_SERVICE_ACCOUNT_JSON,
      });
    });

    it('parses a valid App Store blob for IOS', () => {
      expect(parseStoreCredentialBlob(AppPlatform.IOS, VALID_APPLE_BLOB)).toEqual({
        kind: 'app_store',
        ascIssuerId: '69a6de70-1234-47e3-e053-5b8c7c11a4d1',
        ascKeyId: 'ABC1234DEF',
        ascPrivateKeyP8: VALID_APPLE_BLOB.ascPrivateKeyP8,
        appAppleId: '1234567890',
      });
    });
  });

  describe('platform mismatch → 409', () => {
    it('rejects a google_play blob against IOS', () => {
      expectProblemStatus(() => parseStoreCredentialBlob(AppPlatform.IOS, VALID_GOOGLE_BLOB), 409);
    });

    it('rejects an app_store blob against ANDROID', () => {
      expectProblemStatus(() => parseStoreCredentialBlob(AppPlatform.ANDROID, VALID_APPLE_BLOB), 409);
    });
  });

  describe('malformed Google fields → 422', () => {
    it('rejects serviceAccountJson that is not JSON', () => {
      expectProblemStatus(
        () => parseStoreCredentialBlob(AppPlatform.ANDROID, { kind: 'google_play', serviceAccountJson: 'not-json' }),
        422,
      );
    });

    it('rejects service-account JSON with the wrong type', () => {
      const json = JSON.stringify({ type: 'user', project_id: 'p', client_email: 'a@b.c', private_key: 'k' });
      expectProblemStatus(
        () => parseStoreCredentialBlob(AppPlatform.ANDROID, { kind: 'google_play', serviceAccountJson: json }),
        422,
      );
    });

    it('rejects service-account JSON missing client_email', () => {
      const json = JSON.stringify({ type: 'service_account', project_id: 'p', private_key: 'k' });
      expectProblemStatus(
        () => parseStoreCredentialBlob(AppPlatform.ANDROID, { kind: 'google_play', serviceAccountJson: json }),
        422,
      );
    });

    it('rejects a missing serviceAccountJson field', () => {
      expectProblemStatus(() => parseStoreCredentialBlob(AppPlatform.ANDROID, { kind: 'google_play' }), 422);
    });
  });

  describe('malformed Apple fields → 422', () => {
    it('rejects an ascKeyId that is not 10 chars', () => {
      expectProblemStatus(
        () => parseStoreCredentialBlob(AppPlatform.IOS, { ...VALID_APPLE_BLOB, ascKeyId: 'SHORT' }),
        422,
      );
    });

    it('rejects an ascIssuerId that is not a UUID', () => {
      expectProblemStatus(
        () => parseStoreCredentialBlob(AppPlatform.IOS, { ...VALID_APPLE_BLOB, ascIssuerId: 'not-a-uuid' }),
        422,
      );
    });

    it('rejects an ascPrivateKeyP8 without the PEM header', () => {
      expectProblemStatus(
        () => parseStoreCredentialBlob(AppPlatform.IOS, { ...VALID_APPLE_BLOB, ascPrivateKeyP8: 'MIGTAgEA...' }),
        422,
      );
    });

    it('rejects an appAppleId that is not all digits', () => {
      expectProblemStatus(
        () => parseStoreCredentialBlob(AppPlatform.IOS, { ...VALID_APPLE_BLOB, appAppleId: '12ab34' }),
        422,
      );
    });
  });
});
