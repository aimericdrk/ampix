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
    source: 'client',
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

  it('EVENT_SOURCE_EXPR classifies explicit sources and maps legacy rows via the RC sdk_version stamp', async () => {
    const projectId = randomUUID();
    await service.insertEvents([
      makeEventRow({ project_id: projectId, event: 'client_evt', source: 'client' }),
      makeEventRow({ project_id: projectId, event: 'server_evt', source: 'server' }),
      // Legacy rows written before the column existed read as '' (the column default):
      makeEventRow({ project_id: projectId, event: '$rc_renewal', source: '', sdk_version: 'revenuecat-webhook' }),
      makeEventRow({ project_id: projectId, event: 'old_sdk_evt', source: '' }),
    ]);

    const { EVENT_SOURCE_EXPR } = await import('../../src/analytics/support/property-resolver');
    const rows = await service.query<{ event: string; source: string }>(
      `SELECT event, ${EVENT_SOURCE_EXPR} AS source FROM events
       WHERE project_id = {p:UUID} ORDER BY event`,
      { p: projectId },
    );
    expect(rows).toEqual([
      { event: '$rc_renewal', source: 'server' },
      { event: 'client_evt', source: 'client' },
      { event: 'old_sdk_evt', source: 'client' },
      { event: 'server_evt', source: 'server' },
    ]);
  });

  it('deleteUserData removes only the target ids across events, profiles and identity mappings', async () => {
    const projectId = randomUUID();
    const anonId = randomUUID();
    const now = Date.now();
    await service.insertEvents([
      // pre-login event: distinct_id still equals the anon id
      makeEventRow({ project_id: projectId, distinct_id: anonId, anon_id: anonId }),
      // post-login event under the user id
      makeEventRow({ project_id: projectId, distinct_id: 'u_gone', anon_id: anonId }),
      // bystander who must survive
      makeEventRow({ project_id: projectId, distinct_id: 'u_stays', anon_id: randomUUID() }),
    ]);
    await service.insertProfiles([
      { project_id: projectId, distinct_id: 'u_gone', properties: {}, updated_at: toChDateTime64(now) },
      { project_id: projectId, distinct_id: 'u_stays', properties: {}, updated_at: toChDateTime64(now) },
    ]);
    await admin.insert({
      table: 'identity_mappings',
      values: [{ project_id: projectId, anon_id: anonId, canonical_id: 'u_gone', created_at: toChDateTime64(now) }],
      format: 'JSONEachRow',
    });

    await service.deleteUserData(projectId, ['u_gone', anonId]);

    const events = await service.query<{ distinct_id: string }>(
      'SELECT DISTINCT distinct_id FROM events WHERE project_id = {p:UUID}',
      { p: projectId },
    );
    expect(events.map((row) => row.distinct_id)).toEqual(['u_stays']);
    const profiles = await service.query<{ distinct_id: string }>(
      'SELECT DISTINCT distinct_id FROM user_profiles WHERE project_id = {p:UUID}',
      { p: projectId },
    );
    expect(profiles.map((row) => row.distinct_id)).toEqual(['u_stays']);
    const mappings = await service.query<{ n: string }>(
      'SELECT count() AS n FROM identity_mappings WHERE project_id = {p:UUID}',
      { p: projectId },
    );
    expect(Number(mappings[0].n)).toBe(0);
  });
});
