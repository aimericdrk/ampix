import type { Readable } from 'node:stream';

/** DI token for the {@link ScreenshotStorage} port (an interface can't be injected by type). */
export const SCREENSHOT_STORAGE = 'SCREENSHOT_STORAGE';

/** A stored object read back for proxy-streaming to the client. */
export interface StoredScreenshot {
  stream: Readable;
  contentType: string;
  size: number;
}

/**
 * §18 storage PORT — abstracts where screenshot BYTES live. The prod adapter is Firebase Storage
 * (GCS); an in-memory fake backs every test and is the automatic fallback when Firebase isn't
 * configured. Object paths are deterministic (`screens/{project}/{screen}/{version}.jpg`), so `put`
 * overwrites in place and the metadata row in Postgres references the path.
 */
export interface ScreenshotStorage {
  /** Writes (overwriting) the bytes at `objectPath` with the given content type. */
  put(objectPath: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Reads the object back for streaming, or `null` if it doesn't exist. */
  getStream(objectPath: string): Promise<StoredScreenshot | null>;
  /** A short-lived read URL for the object (used by a redirect-based read path). */
  signedUrl(objectPath: string, ttlSeconds?: number): Promise<string>;
  /** Removes the object; a no-op if it's already gone. */
  delete(objectPath: string): Promise<void>;
}
