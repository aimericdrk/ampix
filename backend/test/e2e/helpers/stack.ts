import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ClickHouseClient, createClient } from '@clickhouse/client';
import { createApp } from '../../../src/main';
import {
  startClickHouseContainer,
  startPostgresContainer,
  startRedisContainer,
} from '../../integration/helpers/containers';
import { applyClickHouseSchema } from '../../integration/helpers/clickhouse-schema';

export interface TestStack {
  app: INestApplication;
  prisma: PrismaClient;
  ch: ClickHouseClient;
  projectId: string;
  sdkToken: string;
  stop(): Promise<void>;
}

/**
 * Boots the REAL application (production createApp wiring) against real
 * ClickHouse + Postgres + Redis containers, with a seeded project + sdk token.
 */
export async function startTestStack(
  envOverrides: Record<string, string> = {},
): Promise<TestStack> {
  const [pg, chc, redis] = await Promise.all([
    startPostgresContainer(),
    startClickHouseContainer(),
    startRedisContainer(),
  ]);

  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: '8080',
    // testcontainers' PostgreSqlContainer#getConnectionUri() emits the `postgres://` scheme;
    // app-config's Zod schema requires `postgresql://` (contracts §3), so normalize it here.
    DATABASE_URL: pg.url.replace(/^postgres:\/\//, 'postgresql://'),
    CLICKHOUSE_URL: chc.url,
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: 'myampmix_dev',
    CLICKHOUSE_DB: 'analytics',
    REDIS_URL: redis.url,
    INGEST_MAX_BATCH: '100',
    INGEST_MAX_BODY_KB: '1024',
    INGEST_RATE_LIMIT_PER_MIN: '1000',
    ...envOverrides,
  });

  const ch = createClient({
    url: chc.url,
    username: 'default',
    password: 'myampmix_dev',
    database: 'analytics',
    // Match ClickHouseService's query settings: ClickHouse 24.8's JSON type infers
    // integer leaves as Int64, which this client would otherwise quote as JSON strings
    // — breaking numeric-property assertions in e2e tests that read data back.
    clickhouse_settings: { output_format_json_quote_64bit_integers: 0 },
  });
  await applyClickHouseSchema(ch);

  const app = await createApp();
  await app.init();

  const prisma = new PrismaClient({ datasources: { db: { url: pg.url } } });
  const org = await prisma.organization.create({ data: { name: 'e2e-org' } });
  const project = await prisma.project.create({ data: { orgId: org.id, name: 'e2e-app' } });
  const sdkToken = 'mam_' + randomBytes(16).toString('hex');
  await prisma.sdkToken.create({ data: { projectId: project.id, token: sdkToken, label: 'e2e' } });

  return {
    app,
    prisma,
    ch,
    projectId: project.id,
    sdkToken,
    stop: async () => {
      await app.close(); // exercises onApplicationShutdown hooks (prisma/redis/clickhouse close)
      await prisma.$disconnect();
      await ch.close();
      await Promise.all([pg.container.stop(), chc.container.stop(), redis.container.stop()]);
    },
  };
}
