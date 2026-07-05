import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
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

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.authorization'],
        autoLogging: true,
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      },
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
  ],
})
export class AppModule {}
