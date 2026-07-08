import { createClient, ClickHouseClient } from '@clickhouse/client';
import type { StartedTestContainer } from 'testcontainers';
import { randomUUID } from 'node:crypto';
import {
  ClickHouseService,
  EventRow,
  toChDateTime64,
} from '../../src/clickhouse/clickhouse.service';
import type { AppConfig } from '../../src/config/app-config';
import { startClickHouseContainer } from './helpers/containers';
import { applyClickHouseSchema } from './helpers/clickhouse-schema';

function makeConfig(url: string): AppConfig {
  return {
    nodeEnv: 'test',
    port: 8080,
    databaseUrl: 'postgresql://unused',
    clickhouse: { url, user: 'default', password: 'myampix_dev', database: 'analytics' },
    redisUrl: 'redis://unused',
    jwtAccessSecret: undefined,
    jwtRefreshSecret: undefined,
    ingestMaxBatch: 100,
    ingestMaxBodyKb: 1024,
    ingestRateLimitPerMin: 1000,
    screenshotMaxKb: 512,
  };
}

function makeEventRow(overrides: Partial<EventRow> = {}): EventRow {
  const now = Date.now();
  return {
    project_id: randomUUID(),
    insert_id: randomUUID(),
    event: 'checkout_completed',
    distinct_id: 'u_42',
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: toChDateTime64(now),
    server_timestamp: toChDateTime64(now),
    properties: { plan: 'pro', value: 9.99 },
    app_version: '1.4.2',
    app_build: '142',
    os: 'ios',
    os_version: '18.5',
    device_model: 'iPhone16,2',
    device_manufacturer: 'Apple',
    locale: 'fr_FR',
    timezone: 'Europe/Paris',
    screen_width: 393,
    screen_height: 852,
    network: 'wifi',
    sdk_version: '0.1.0',
    utm_source: 'tiktok',
    utm_medium: 'paid',
    utm_campaign: 'summer',
    utm_content: '',
    utm_term: '',
    first_utm_source: 'meta',
    first_utm_campaign: 'launch',
    install_referrer: '',
    ...overrides,
  };
}

describe('ClickHouseService (integration)', () => {
  let container: StartedTestContainer;
  let admin: ClickHouseClient;
  let service: ClickHouseService;

  beforeAll(async () => {
    const started = await startClickHouseContainer();
    container = started.container;
    admin = createClient({
      url: started.url,
      username: 'default',
      password: 'myampix_dev',
      database: 'analytics',
    });
    await applyClickHouseSchema(admin);
    service = new ClickHouseService(makeConfig(started.url));
  });

  afterAll(async () => {
    await service.onApplicationShutdown();
    await admin.close();
    await container.stop();
  });

  it('pings', async () => {
    expect(await service.ping()).toBe(true);
  });

  it('inserts events with async_insert ack and collapses duplicates by insert_id', async () => {
    const row = makeEventRow();
    await service.insertEvents([row]);
    await service.insertEvents([row]); // simulated SDK retry of the same batch

    const rows = await service.query<{ n: string }>(
      'SELECT count(DISTINCT insert_id) AS n FROM events WHERE project_id = {p:UUID}',
      { p: row.project_id },
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it('round-trips the properties JSON column', async () => {
    const row = makeEventRow();
    await service.insertEvents([row]);
    const rows = await service.query<{ properties: { plan: string; value: number } }>(
      'SELECT properties FROM events WHERE project_id = {p:UUID} LIMIT 1',
      { p: row.project_id },
    );
    expect(rows[0].properties.plan).toBe('pro');
  });

  it('writes user_profiles rows where the latest updated_at wins', async () => {
    const projectId = randomUUID();
    await service.insertProfiles([
      {
        project_id: projectId,
        distinct_id: 'u_1',
        properties: { plan: 'free' },
        updated_at: toChDateTime64(Date.now() - 1000),
      },
      {
        project_id: projectId,
        distinct_id: 'u_1',
        properties: { plan: 'pro' },
        updated_at: toChDateTime64(Date.now()),
      },
    ]);
    const rows = await service.query<{ properties: { plan: string } }>(
      'SELECT properties FROM user_profiles FINAL WHERE project_id = {p:UUID} AND distinct_id = {d:String}',
      { p: projectId, d: 'u_1' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].properties.plan).toBe('pro');
  });
});
