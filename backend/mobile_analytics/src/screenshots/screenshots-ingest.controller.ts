import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProblemException } from '../common/problem-details';
import type { IngestRequest } from '../ingestion/ingest-auth';
import { IngestRateLimitGuard } from '../ingestion/rate-limit.guard';
import { SdkTokenGuard } from '../ingestion/sdk-token.guard';
import { ScreenshotsService } from './screenshots.service';

/**
 * Hard ceiling on the buffered multipart upload — a DoS safety net set well above SCREENSHOT_MAX_KB.
 * The precise, config-driven size cap is enforced in {@link ScreenshotsService} and returns a clean
 * 413; this only exists so a hostile client can't stream unbounded bytes into memory. It cannot read
 * the config at decoration time (decorators run at import, before per-test env is applied), so it is
 * a fixed constant rather than `SCREENSHOT_MAX_KB`.
 */
const MULTER_HARD_CAP_BYTES = 8 * 1024 * 1024;

/** Just the fields ScreenshotsService needs from multer's default (memory) file object. */
interface UploadedImage {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

/** The multipart text fields (multer parses these into req.body alongside the file). */
interface ScreenshotFields {
  screen_name?: string;
  app_version?: string;
  width?: string;
  height?: string;
  /** Full-page captures only — see ScreenCapture.contentHeight. Absent on a single-viewport shot. */
  content_height?: string;
  viewport_height?: string;
  /** Full-page captures only — see ScreenCapture.contentTop. 0 is a valid value (no top chrome). */
  content_top?: string;
  image_hash?: string;
}

/** Parses a non-negative integer field, defaulting to 0 for a missing/garbage value. */
function toNonNegativeInt(value: string | undefined): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Optional positive float field → `undefined` when absent OR unparseable. Deliberately NOT 0: these
 * describe a full-page capture's geometry, and 0 would claim "a page of no height" rather than
 * "this was a single-viewport capture", which is what the read path keys off.
 */
function toOptionalPositiveFloat(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Like [toOptionalPositiveFloat] but 0 is VALID: `content_top` of 0 means "the scrollable starts
 * at the very top of the screen — there is no chrome above it", a real and common layout.
 */
function toOptionalNonNegativeFloat(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * §18 — `POST /ingest/screenshots`. Same SDK-token auth + per-token rate limit as `POST
 * /ingest/events` (reuses the ingestion module's guards). Accepts multipart/form-data with the
 * `image` JPEG part plus `screen_name`, `app_version`, `width`, `height`, `image_hash` fields, then
 * UPSERTs on the unique triple. → `202 {"stored": true}`.
 */
@Controller('ingest/screenshots')
@UseGuards(SdkTokenGuard, IngestRateLimitGuard)
export class ScreenshotsIngestController {
  constructor(private readonly screenshots: ScreenshotsService) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor('image', { limits: { files: 1, fileSize: MULTER_HARD_CAP_BYTES } }),
  )
  async upload(
    @Req() req: IngestRequest,
    @UploadedFile() file: UploadedImage | undefined,
    @Body() body: ScreenshotFields,
  ): Promise<{ stored: boolean }> {
    if (!file) {
      throw new ProblemException({
        status: 400,
        title: 'Bad Request',
        detail: 'Missing image file part',
      });
    }
    return this.screenshots.store({
      projectId: req.ingestAuth!.projectId,
      screenName: (body.screen_name ?? '').trim(),
      appVersion: (body.app_version ?? '').trim(),
      width: toNonNegativeInt(body.width),
      height: toNonNegativeInt(body.height),
      contentHeight: toOptionalPositiveFloat(body.content_height),
      viewportHeight: toOptionalPositiveFloat(body.viewport_height),
      contentTop: toOptionalNonNegativeFloat(body.content_top),
      imageHash: (body.image_hash ?? '').trim(),
      contentType: file.mimetype,
      image: file.buffer,
    });
  }
}
