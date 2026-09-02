import type { ClickHouseService } from '../../../clickhouse/clickhouse.service';
import type { ProjectsService } from '../../../projects/core/projects.service';
import { AttributionService } from './attribution.service';

const USER = 'user-1';
const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';

/**
 * The service fires, in order: totals, then one query per breakdown (source, campaign, medium,
 * referrer), then the accounts list. `queue` supplies each in that order.
 */
function make(queue: unknown[][], hiddenIds: string[] = []) {
  let call = 0;
  const clickhouse = {
    query: jest.fn((_sql: string, _params?: Record<string, unknown>) =>
      Promise.resolve(queue[call++] ?? []),
    ),
  };
  const projects = { assertMembership: jest.fn().mockResolvedValue(undefined) };
  const hidden = { hiddenIds: jest.fn().mockResolvedValue(hiddenIds) };
  const service = new AttributionService(
    clickhouse as unknown as ClickHouseService,
    projects as unknown as ProjectsService,
    hidden,
  );
  return { service, clickhouse, projects, hidden };
}

const EMPTY_QUEUE = [[{ installs: 0, signups: 0 }], [], [], [], [], []];

describe('AttributionService', () => {
  it('asserts project membership before querying', async () => {
    const { service, projects } = make(EMPTY_QUEUE);
    await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    expect(projects.assertMembership).toHaveBeenCalledWith(USER, PROJECT);
  });

  it('reports installs and signups side by side with a signup rate', async () => {
    const { service } = make([
      [{ installs: 1000, signups: 250 }],
      [{ value: 'google-play', installs: 600, signups: 180 }],
      [],
      [],
      [],
      [],
    ]);
    const result = await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    expect(result.total_installs).toBe(1000);
    expect(result.total_signups).toBe(250);
    expect(result.signup_rate).toBeCloseTo(0.25, 10);
    expect(result.by_source[0]).toEqual({
      value: 'google-play',
      installs: 600,
      signups: 180,
      signup_rate: 0.3,
    });
  });

  it('leaves the signup rate NULL when a source has no installs in the window', async () => {
    // A signup from an install made BEFORE the window is real; reporting 0% would rank this
    // source as the worst performer rather than an out-of-window one.
    const { service } = make([
      [{ installs: 0, signups: 5 }],
      [{ value: 'newsletter', installs: 0, signups: 5 }],
      [],
      [],
      [],
      [],
    ]);
    const result = await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    expect(result.signup_rate).toBeNull();
    expect(result.by_source[0].signup_rate).toBeNull();
  });

  it('maps an empty attribution value to null so the UI can label it', async () => {
    const { service } = make([
      [{ installs: 10, signups: 1 }],
      [{ value: '', installs: 10, signups: 1 }],
      [],
      [],
      [],
      [],
    ]);
    const result = await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    expect(result.by_source[0].value).toBeNull();
  });

  it('maps accounts, converting ClickHouse timestamps to ISO instants', async () => {
    const { service } = make([
      [{ installs: 1, signups: 1 }],
      [],
      [],
      [],
      [],
      [
        {
          distinct_id: 'u1',
          first_seen: '2026-06-02 09:00:00.000',
          signed_up_at: '2026-06-03 11:30:00.000',
          has_signup: 1,
          name: 'Ada',
          email: 'ada@example.com',
          first_utm_source: 'google-play',
          first_utm_campaign: 'launch',
          utm_source: 'google-play',
          utm_medium: 'organic',
          utm_campaign: 'launch',
          install_referrer: 'utm_source=google-play',
        },
      ],
    ]);
    const result = await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    expect(result.accounts[0]).toEqual({
      distinct_id: 'u1',
      first_seen: '2026-06-02T09:00:00.000Z',
      signed_up_at: '2026-06-03T11:30:00.000Z',
      name: 'Ada',
      email: 'ada@example.com',
      first_utm_source: 'google-play',
      first_utm_campaign: 'launch',
      utm_source: 'google-play',
      utm_medium: 'organic',
      utm_campaign: 'launch',
      install_referrer: 'utm_source=google-play',
    });
  });

  it('reports a never-signed-up account as null, not as a 1970 signup', async () => {
    // minIf over zero matching rows returns the epoch default for a non-Nullable DateTime64 —
    // has_signup, not the timestamp, is what decides.
    const { service } = make([
      [{ installs: 1, signups: 0 }],
      [],
      [],
      [],
      [],
      [
        {
          distinct_id: 'u2',
          first_seen: '2026-06-02 09:00:00.000',
          signed_up_at: '1970-01-01 00:00:00.000',
          has_signup: 0,
          name: '',
          email: '',
          first_utm_source: '',
          first_utm_campaign: '',
          utm_source: '',
          utm_medium: '',
          utm_campaign: '',
          install_referrer: '',
        },
      ],
    ]);
    const result = await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    expect(result.accounts[0].signed_up_at).toBeNull();
    expect(result.accounts[0].name).toBeNull();
    expect(result.accounts[0].first_utm_source).toBeNull();
  });

  it('excludes hidden users by binding their ids, never interpolating them', async () => {
    const { service, clickhouse } = make(EMPTY_QUEUE, ['staff-1', 'staff-2']);
    await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    const [sql, params] = clickhouse.query.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.hiddenIds).toEqual(['staff-1', 'staff-2']);
    expect(sql).toContain('HAVING uid NOT IN {hiddenIds:Array(String)}');
    expect(sql).not.toContain('staff-1');
  });

  it('emits no hidden clause at all when nothing is hidden', async () => {
    const { service, clickhouse } = make(EMPTY_QUEUE);
    await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    const [sql, params] = clickhouse.query.mock.calls[0] as [string, Record<string, unknown>];
    expect(sql).not.toContain('hiddenIds');
    expect(params.hiddenIds).toBeUndefined();
  });

  it('attributes each user by their FIRST touch, not their latest', async () => {
    const { service, clickhouse } = make(EMPTY_QUEUE);
    await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    const [sql] = clickhouse.query.mock.calls[0] as [string];
    expect(sql).toContain('argMinIf(e.first_utm_source, e.timestamp');
    expect(sql).not.toContain('argMax(e.first_utm_source');
  });

  it('takes the earliest NON-EMPTY touch, so a late-resolving referrer is not lost', async () => {
    const { service, clickhouse } = make(EMPTY_QUEUE);
    await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    const [sql] = clickhouse.query.mock.calls[0] as [string];
    // `first_utm_source` is written once and never overwritten, so any non-empty occurrence is the
    // same first touch — but it does not always ride on the very first event. A plain argMin filed
    // those users under Direct / unknown.
    for (const column of ['first_utm_source', 'first_utm_campaign', 'install_referrer']) {
      expect(sql).toContain(`argMinIf(e.${column}, e.timestamp, e.${column} != '')`);
    }
  });

  it('counts each canonical user once, not once per event', async () => {
    const { service, clickhouse } = make(EMPTY_QUEUE);
    await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    const [sql] = clickhouse.query.mock.calls[0] as [string];
    // The install/signup windows are evaluated over the per-user CTE, not over raw events.
    expect(sql).toContain('FROM first_touch');
    expect(sql).toContain('coalesce(aliases.canonical_id, e.distinct_id)');
  });

  it('counts only what a DEVICE did — a backend writing about someone is not an install', async () => {
    const { service, clickhouse } = make(EMPTY_QUEUE);
    await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    const [sql, params] = clickhouse.query.mock.calls[0] as [string, Record<string, unknown>];
    // Without this, every user id a backend ever mentioned became an install on the day it first
    // wrote about them — and, because a server row carries no utm columns and lands ahead of the
    // device, argMin picked it as the first touch and wiped a real campaign to Direct / unknown.
    expect(params.clientSource).toBe('client');
    expect(sql).toContain('{clientSource:String}');
    // Classified through the shared expression, so rows written before the `source` column existed
    // still resolve via the RevenueCat sdk_version stamp rather than counting as devices.
    expect(sql).toContain("sdk_version = 'revenuecat-webhook'");
  });

  it('binds the $identify event name as a param rather than embedding it', async () => {
    const { service, clickhouse } = make(EMPTY_QUEUE);
    await service.getAttribution(USER, PROJECT, '2026-06-01', '2026-06-30');
    const [sql, params] = clickhouse.query.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.identifyEvent).toBe('$identify');
    expect(sql).toContain('{identifyEvent:String}');
  });
});
