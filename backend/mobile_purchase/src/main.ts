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
  app.useLogger(app.get(Logger));
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
