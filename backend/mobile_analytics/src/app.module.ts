import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerModule, Params } from 'nestjs-pino';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { ClickHouseModule } from './clickhouse/clickhouse.module';
import { IngestModule } from './ingestion/ingest.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { InvitationsModule } from './invitations/invitations.module';
import { OrgsModule } from './orgs/orgs.module';
import { ProjectsModule } from './projects/projects.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CohortsModule } from './cohorts/cohorts.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { TemplatesModule } from './templates/templates.module';
import { ScreenshotsModule } from './screenshots/screenshots.module';
import { RevenueCatModule } from './revenuecat/revenuecat.module';
import { InternalModule } from './internal/internal.module';
import { ErasureModule } from './erasure/erasure.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Params => ({
        pinoHttp: {
          // §20 — base level from validated config (default 'info'). At 'info', the customLogLevel
          // below demotes successful (2xx/3xx) request logs to 'debug' so they're filtered out,
          // while app logs (info) and 4xx/5xx request logs still surface.
          level: config.logLevel ?? 'info',
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
    RedisModule,
    ClickHouseModule,
    IngestModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    OrgsModule,
    InvitationsModule,
    CohortsModule,
    AnalyticsModule,
    ReportsModule,
    DashboardsModule,
    TemplatesModule,
    ScreenshotsModule,
    RevenueCatModule,
    InternalModule,
    ErasureModule,
  ],
})
export class AppModule {}
