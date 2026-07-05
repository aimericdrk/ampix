import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { ScreenshotStorage, StoredScreenshot } from './screenshot-storage.port';

/** The GCS `Bucket` type, derived from firebase-admin so no direct @google-cloud/storage import. */
type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

/**
 * §18 production {@link ScreenshotStorage} backed by Firebase Storage (a GCS bucket) via
 * `firebase-admin`. Thin + integration-only per contract (not unit-tested): tests and unconfigured
 * environments use the in-memory fake instead. Credentials come from Application Default Credentials
 * / `GOOGLE_APPLICATION_CREDENTIALS`, read by firebase-admin from the environment.
 */
export class FirebaseScreenshotStorage implements ScreenshotStorage {
  private readonly bucket: Bucket;
  readonly bucketName: string;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
    // Reuse an already-initialized default app (idempotent across module re-instantiation) rather
    // than calling initializeApp twice, which throws.
    const app: App =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({ credential: applicationDefault(), storageBucket: bucketName });
    this.bucket = getStorage(app).bucket(bucketName);
  }

  async probe(): Promise<{ ok: boolean; detail?: string }> {
    // Lightweight, read-only reachability + credentials check. `exists()` round-trips to GCS with
    // the resolved credentials, so it fails loudly on bad/absent ADC, a wrong/missing bucket, or
    // insufficient IAM — exactly the states that otherwise leave the bucket silently empty.
    try {
      const [exists] = await this.bucket.exists();
      if (!exists) {
        return {
          ok: false,
          detail: `bucket "${this.bucketName}" does not exist or the credentials cannot see it`,
        };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async put(objectPath: string, bytes: Buffer, contentType: string): Promise<void> {
    // resumable:false → a single request (right for small, deterministic-path overwrites).
    await this.bucket.file(objectPath).save(bytes, { contentType, resumable: false });
  }

  async getStream(objectPath: string): Promise<StoredScreenshot | null> {
    const file = this.bucket.file(objectPath);
    const [exists] = await file.exists();
    if (!exists) {
      return null;
    }
    const [metadata] = await file.getMetadata();
    return {
      stream: file.createReadStream(),
      contentType: metadata.contentType ?? 'application/octet-stream',
      size: Number(metadata.size ?? 0),
    };
  }

  async signedUrl(objectPath: string, ttlSeconds = 300): Promise<string> {
    const [url] = await this.bucket.file(objectPath).getSignedUrl({
      action: 'read',
      expires: Date.now() + ttlSeconds * 1000,
    });
    return url;
  }

  async delete(objectPath: string): Promise<void> {
    await this.bucket.file(objectPath).delete({ ignoreNotFound: true });
  }
}
