import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/app-config';

/** Builds the fully wired application. Reused by e2e tests so they exercise production wiring. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port, '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
