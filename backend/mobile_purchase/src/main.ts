// Local dev: load backend/mobile_purchase/.env before anything reads process.env.
// Real environment variables take precedence — loadEnvFile never overrides vars that are
// already set — and production/CI (no .env file) falls through to the real environment.
try {
  process.loadEnvFile();
} catch {
  // No .env file — the environment is already configured.
}

import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig, describeConfig } from './config/app-config';

/** Builds the fully wired application. Reused by e2e tests so they exercise production wiring. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);
  app.useLogger(app.get(Logger));
  // CORS for the dashboard→mobile_purchase reach (design §2): the MyRevenueCat data pages call
  // this service cross-origin (both services expose /api/v1/projects/:projectId/…, so the dashboard
  // cannot proxy same-origin). Only the configured dashboard origin(s) may send credentialed
  // requests; the Authorization bearer + Content-Type are allowed and the OPTIONS preflight is
  // answered here — before routing — so it never reaches ProjectAccessGuard.
  app.enableCors({
    origin: config.dashboardOrigins ?? [],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  });
  app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  app.get(Logger).log({ config: describeConfig(config) }, 'Effective configuration (redacted)');
  await app.listen(config.port, '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
