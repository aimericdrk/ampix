import { Readable } from 'node:stream';
import { ScreenshotStorage, StoredScreenshot } from './screenshot-storage.port';

interface StoredBytes {
  bytes: Buffer;
  contentType: string;
}

/**
 * §18 in-memory {@link ScreenshotStorage}. Backs ALL tests (no real Firebase) and is the automatic
 * fallback when `FIREBASE_STORAGE_BUCKET` is unset, so the app boots + serves screenshots locally
 * without any Google credentials. Bytes live only in-process (a process restart loses them) — never
 * for production use.
 */
export class InMemoryScreenshotStorage implements ScreenshotStorage {
  private readonly objects = new Map<string, StoredBytes>();

  async put(objectPath: string, bytes: Buffer, contentType: string): Promise<void> {
    // Copy so a later mutation of the caller's buffer can't corrupt the stored bytes.
    this.objects.set(objectPath, { bytes: Buffer.from(bytes), contentType });
  }

  async getStream(objectPath: string): Promise<StoredScreenshot | null> {
    const obj = this.objects.get(objectPath);
    if (!obj) {
      return null;
    }
    return {
      stream: Readable.from(obj.bytes),
      contentType: obj.contentType,
      size: obj.bytes.length,
    };
  }

  async signedUrl(objectPath: string): Promise<string> {
    // No real signing in-memory; a stable pseudo-URL keeps a redirect-based caller functional in dev.
    return `memory://screenshots/${objectPath}`;
  }

  async delete(objectPath: string): Promise<void> {
    this.objects.delete(objectPath);
  }
}
