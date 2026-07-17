import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerModule, Params } from 'nestjs-pino';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthzModule } from './authz/authz.module';
import { CatalogModule } from './catalog/catalog.module';
import { CustomersModule } from './customers/customers.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Params => ({
        pinoHttp: {
          level: config.logLevel,
          customLogLevel: (_req, res, err) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'debug';
          },
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id =
              typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          redact: ['req.headers.authorization'],
          autoLogging: true,
          transport:
            process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        },
      }),
    }),
    PrismaModule,
    HealthModule,
    AuthzModule,
    CatalogModule,
    CustomersModule,
    WebhooksModule,
  ],
})
export class AppModule {}
