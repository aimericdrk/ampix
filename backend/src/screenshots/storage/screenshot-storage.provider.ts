import { Logger, Provider } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { FirebaseScreenshotStorage } from './firebase-screenshot-storage';
import { InMemoryScreenshotStorage } from './in-memory-screenshot-storage';
import { SCREENSHOT_STORAGE, ScreenshotStorage } from './screenshot-storage.port';

/**
 * Selects the screenshot storage adapter from config: Firebase Storage when `FIREBASE_STORAGE_BUCKET`
 * is set (and initializes cleanly), otherwise the in-memory fake — with a clear warning — so the app
 * boots and serves screenshots in local dev / tests without Google credentials. A Firebase init
 * failure (e.g. missing credentials) also degrades to in-memory rather than crashing boot.
 */
export function createScreenshotStorage(
  config: AppConfig,
  logger: Logger = new Logger('ScreenshotStorage'),
): ScreenshotStorage {
  const bucket = config.firebaseStorageBucket;
  if (!bucket) {
    logger.warn(
      'FIREBASE_STORAGE_BUCKET not set — using the in-memory screenshot store (dev/test). Screenshot bytes are NOT persisted across restarts.',
    );
    return new InMemoryScreenshotStorage();
  }
  try {
    const storage = new FirebaseScreenshotStorage(bucket);
    logger.log(`Screenshots persisted to Firebase Storage bucket "${bucket}".`);
    return storage;
  } catch (err) {
    logger.warn(
      `Firebase Storage init failed (${String(err)}); falling back to the in-memory screenshot store.`,
    );
    return new InMemoryScreenshotStorage();
  }
}

/** DI provider wiring the selected adapter to the {@link SCREENSHOT_STORAGE} token. */
export const screenshotStorageProvider: Provider = {
  provide: SCREENSHOT_STORAGE,
  useFactory: (config: AppConfig) => createScreenshotStorage(config),
  inject: [APP_CONFIG],
};
