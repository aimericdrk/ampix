import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { IngestModule } from '../ingestion/ingest.module';
import { ProjectsModule } from '../projects/projects.module';
import { ScreensController } from './screens.controller';
import { ScreenshotsIngestController } from './screenshots-ingest.controller';
import { ScreenshotsService } from './screenshots.service';
import { screenshotStorageProvider } from './storage/screenshot-storage.provider';

/**
 * §18 — automatic screenshot pipeline (backend). Bundles the token-auth ingest endpoint and the
 * JWT + membership-gated read endpoints behind one service, plus the {@link ScreenshotStorage} port
 * (Firebase in prod, in-memory fake otherwise). Imports {@link IngestModule} to reuse its SDK-token +
 * rate-limit guards, {@link AuthModule} for the JWT guard, and {@link ProjectsModule} for the
 * `assertMembership` tenancy check.
 */
@Module({
  imports: [AuthModule, AuthzModule, ProjectsModule, IngestModule],
  controllers: [ScreenshotsIngestController, ScreensController],
  providers: [ScreenshotsService, screenshotStorageProvider],
})
export class ScreenshotsModule {}
