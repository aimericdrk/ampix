/**
 * Unit coverage for the ONE piece of the Firebase adapter that must work at boot: `probe()`. The
 * rest of the adapter is integration-only (real GCS), but probe's whole job is to turn bad
 * credentials / a wrong bucket / missing permissions into a clear `{ok:false, detail}` instead of a
 * silently-empty bucket — so it's worth pinning with a mocked `firebase-admin`.
 */
const mockExists = jest.fn();
const mockBucket = { exists: mockExists };

jest.mock('firebase-admin/app', () => ({
  applicationDefault: jest.fn(() => ({})),
  getApps: jest.fn(() => [{ name: '[DEFAULT]' }]),
  initializeApp: jest.fn(() => ({ name: '[DEFAULT]' })),
}));
jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn(() => ({ bucket: () => mockBucket })),
}));

import { FirebaseScreenshotStorage } from './firebase-screenshot-storage';

describe('FirebaseScreenshotStorage.probe', () => {
  beforeEach(() => {
    mockExists.mockReset();
  });

  it('reports ok when the bucket exists', async () => {
    mockExists.mockResolvedValue([true]);
    const storage = new FirebaseScreenshotStorage('my-bucket.appspot.com');
    await expect(storage.probe()).resolves.toEqual({ ok: true });
    expect(storage.bucketName).toBe('my-bucket.appspot.com');
  });

  it('reports not-ok with a detail naming the bucket when it does not exist', async () => {
    mockExists.mockResolvedValue([false]);
    const storage = new FirebaseScreenshotStorage('missing-bucket');
    const result = await storage.probe();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('missing-bucket');
  });

  it('reports not-ok with the real error message when exists() throws (bad creds / permissions)', async () => {
    mockExists.mockRejectedValue(new Error('Could not load the default credentials'));
    const storage = new FirebaseScreenshotStorage('any-bucket');
    const result = await storage.probe();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Could not load the default credentials');
  });
});
