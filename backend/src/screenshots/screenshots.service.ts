import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ProblemException } from '../common/problem-details';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { SCREENSHOT_STORAGE, ScreenshotStorage } from './storage/screenshot-storage.port';

/** Normalized, already-extracted screenshot upload (multipart parsing happens in the controller). */
export interface StoreScreenshotInput {
  projectId: string;
  screenName: string;
  appVersion: string;
  width: number;
  height: number;
  imageHash: string;
  contentType: string;
  image: Buffer;
}

/** One row of `GET /screens` — a screen with its per-version capture count + latest metadata. */
export interface ScreenListItem {
  screen_name: string;
  capture_count: number;
  latest_captured_at: string;
  width: number;
  height: number;
}

/** The JPEG stream + content type served by `GET /screens/:screenName/image`. */
export interface ScreenImage {
  stream: Readable;
  contentType: string;
}

/** Which capture to serve when several versions exist (both optional; newest wins otherwise). */
export interface ScreenImageSelector {
  appVersion?: string;
  hash?: string;
}

const JPEG_CONTENT_TYPE = 'image/jpeg';

/**
 * Deterministic bucket object path for a capture: `screens/{project}/{screen}/{version}.jpg`. Path
 * segments are URI-encoded so a screen name or app version containing `/` (or other unsafe chars)
 * can neither escape the `screens/{project}` prefix nor collide with another screen.
 */
export function screenshotObjectPath(
  projectId: string,
  screenName: string,
  appVersion: string,
): string {
  return `screens/${projectId}/${encodeURIComponent(screenName)}/${encodeURIComponent(appVersion)}.jpg`;
}

/**
 * §18 — automatic screenshot storage + serving. The image BYTES go to Firebase Storage (via the
 * {@link ScreenshotStorage} port); Postgres holds only metadata + the object path. Storage is
 * bounded/deduped: exactly ONE image per `(project_id, screen_name, app_version)`. `store` puts the
 * bytes at the deterministic path (overwrite) and UPSERTs the metadata row; the read methods gate on
 * project membership (viewer+) via {@link ProjectsService}, the same tenancy check §14/§19 use.
 */
@Injectable()
export class ScreenshotsService implements OnModuleInit {
  private readonly logger = new Logger(ScreenshotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SCREENSHOT_STORAGE) private readonly storage: ScreenshotStorage,
  ) {}

  /**
   * Boot-time storage self-check. Probes the configured backend once so bad credentials / a wrong or
   * missing bucket / insufficient permissions surface LOUDLY at startup instead of silently on the
   * first upload (bucket stays empty, logs say nothing). Never crashes boot — screenshots degrade,
   * the rest of the app keeps running. Only the Firebase backend is probed for reachability; the
   * in-memory fallback (no bucket configured) has nothing remote to reach.
   */
  async onModuleInit(): Promise<void> {
    const bucket = this.config.firebaseStorageBucket;
    if (!bucket) {
      // In-memory fallback (dev/test) — the provider already warned bytes aren't persisted.
      return;
    }
    let result: { ok: boolean; detail?: string };
    try {
      result = await this.storage.probe();
    } catch (err) {
      // probe() is contracted never to throw, but never let a storage hiccup take down boot.
      result = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    if (result.ok) {
      this.logger.log(`✓ Firebase Storage reachable: gs://${bucket}`);
    } else {
      this.logger.error(
        `✗ Firebase Storage NOT reachable: ${result.detail ?? 'unknown error'} (bucket gs://${bucket}) — screenshot uploads will fail until this is fixed`,
      );
    }
  }

  /**
   * Validates (type / size / required fields), writes the bytes to storage at the deterministic
   * path, then UPSERTs the metadata on the unique triple — a re-send for the same
   * `(project, screen, app_version)` overwrites both the object and the row (still one per version).
   * `captured_at` (create-only default) marks the first upload of a version; `updated_at` bumps on
   * every replace.
   */
  async store(input: StoreScreenshotInput): Promise<{ stored: boolean }> {
    this.validate(input);
    const storagePath = screenshotObjectPath(input.projectId, input.screenName, input.appVersion);
    // Put the bytes first: if this fails we throw and never persist a metadata row pointing at a
    // missing object. The deterministic path makes both the put and a later upsert idempotent.
    try {
      await this.storage.put(storagePath, input.image, input.contentType);
    } catch (err) {
      // The bucket stays empty and nobody knows why — so make it LOUD: the real error (message +
      // stack) plus the path and bucket go to the logs at ERROR, and the underlying reason rides
      // along in the 502 detail so the HTTP response itself explains the failure.
      const reason = err instanceof Error ? err.message : String(err);
      const bucket = this.config.firebaseStorageBucket;
      this.logger.error(
        `screenshot storage put FAILED screen=${input.screenName} app_version=${input.appVersion} path=${storagePath}${bucket ? ` bucket=gs://${bucket}` : ''}: ${reason}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new ProblemException({
        status: 502,
        title: 'Bad Gateway',
        detail: `Failed to store screenshot in object storage: ${reason}`,
      });
    }
    await this.prisma.screenCapture.upsert({
      where: {
        projectId_screenName_appVersion: {
          projectId: input.projectId,
          screenName: input.screenName,
          appVersion: input.appVersion,
        },
      },
      create: {
        projectId: input.projectId,
        screenName: input.screenName,
        appVersion: input.appVersion,
        storagePath,
        contentType: input.contentType,
        width: input.width,
        height: input.height,
        imageHash: input.imageHash,
      },
      update: {
        storagePath,
        contentType: input.contentType,
        width: input.width,
        height: input.height,
        imageHash: input.imageHash,
      },
    });
    this.logger.log(
      `screenshot stored screen=${input.screenName} app_version=${input.appVersion} path=${storagePath}`,
    );
    return { stored: true };
  }

  private validate(input: StoreScreenshotInput): void {
    if (!input.image || input.image.length === 0) {
      throw new ProblemException({ status: 400, title: 'Bad Request', detail: 'Missing image file' });
    }
    if (input.contentType !== JPEG_CONTENT_TYPE) {
      throw new ProblemException({
        status: 415,
        title: 'Unsupported Media Type',
        detail: `Screenshot must be ${JPEG_CONTENT_TYPE}`,
      });
    }
    const maxBytes = this.config.screenshotMaxKb * 1024;
    if (input.image.length > maxBytes) {
      throw new ProblemException({
        status: 413,
        title: 'Payload Too Large',
        detail: `Screenshot exceeds SCREENSHOT_MAX_KB=${this.config.screenshotMaxKb}`,
      });
    }
    if (!input.screenName) {
      throw new ProblemException({ status: 400, title: 'Bad Request', detail: 'Missing screen_name' });
    }
    if (!input.appVersion) {
      throw new ProblemException({ status: 400, title: 'Bad Request', detail: 'Missing app_version' });
    }
  }

  /**
   * Lists the screens captured for a project. `capture_count` is the number of app versions stored
   * for that screen; `width`/`height`/`latest_captured_at` come from the most recent capture. Reads
   * metadata only — no bytes are fetched from storage.
   */
  async listScreens(userId: string, projectId: string): Promise<{ screens: ScreenListItem[] }> {
    await this.projects.assertMembership(userId, projectId);
    const rows = await this.prisma.screenCapture.findMany({
      where: { projectId },
      select: { screenName: true, width: true, height: true, capturedAt: true },
      orderBy: { capturedAt: 'desc' },
    });

    const byScreen = new Map<string, ScreenListItem>();
    for (const row of rows) {
      const existing = byScreen.get(row.screenName);
      if (existing) {
        existing.capture_count += 1;
      } else {
        // Rows are ordered captured_at desc, so the first row seen per screen is its latest capture.
        byScreen.set(row.screenName, {
          screen_name: row.screenName,
          capture_count: 1,
          latest_captured_at: row.capturedAt.toISOString(),
          width: row.width,
          height: row.height,
        });
      }
    }

    const screens = [...byScreen.values()].sort((a, b) =>
      a.screen_name.localeCompare(b.screen_name),
    );
    return { screens };
  }

  /**
   * Resolves one screen's JPEG stream, proxied from storage. With no selector the newest capture
   * (by `captured_at`) is served; an `appVersion` and/or `hash` narrows to a specific one. 404 when
   * no metadata row matches or the underlying object is gone.
   */
  async getImage(
    userId: string,
    projectId: string,
    screenName: string,
    selector: ScreenImageSelector = {},
  ): Promise<ScreenImage> {
    await this.projects.assertMembership(userId, projectId);
    const capture = await this.prisma.screenCapture.findFirst({
      where: {
        projectId,
        screenName,
        ...(selector.appVersion ? { appVersion: selector.appVersion } : {}),
        ...(selector.hash ? { imageHash: selector.hash } : {}),
      },
      orderBy: { capturedAt: 'desc' },
      select: { storagePath: true, contentType: true },
    });
    if (!capture) {
      throw this.imageNotFound();
    }
    const object = await this.storage.getStream(capture.storagePath);
    if (!object) {
      // Metadata exists but the object is missing (e.g. in-memory store after a restart) — treat as
      // not found rather than surfacing an empty/broken image.
      throw this.imageNotFound();
    }
    return { stream: object.stream, contentType: object.contentType || capture.contentType };
  }

  /**
   * §18 retake/delete: removes a screen's stored image(s) — the storage object(s) AND the metadata
   * row(s). Deletes every version, or a single one when `appVersion` is given. Never fails on a
   * missing object (`ignoreNotFound` in the adapter). Role gating (analyst+) is enforced by the
   * controller's `RolesGuard`, so there's no membership re-check here.
   */
  async deleteScreen(projectId: string, screenName: string, appVersion?: string): Promise<void> {
    const where = { projectId, screenName, ...(appVersion ? { appVersion } : {}) };
    const rows = await this.prisma.screenCapture.findMany({
      where,
      select: { storagePath: true },
    });
    await Promise.all(
      rows.map((row) =>
        this.storage.delete(row.storagePath).catch((error: unknown) => {
          this.logger.warn(
            `screenshot object delete failed path=${row.storagePath}: ${String(error)}`,
          );
        }),
      ),
    );
    await this.prisma.screenCapture.deleteMany({ where });
  }

  private imageNotFound(): ProblemException {
    return new ProblemException({
      status: 404,
      title: 'Not Found',
      detail: 'No screenshot found for this screen',
    });
  }
}
