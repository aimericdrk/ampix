import { randomUUID } from 'node:crypto';
import {
  clampTimestamp,
  EventNormalizer,
  TIMESTAMP_FUTURE_LIMIT_MS,
  TIMESTAMP_PAST_LIMIT_MS,
} from './event-normalizer';

const PROJECT_ID = '018f6b2e-0000-7000-8000-000000000001';
const NOW = Date.UTC(2026, 6, 2, 12, 0, 0, 0); // 2026-07-02T12:00:00.000Z
/** The connection address the controller passes in — server-derived, never from the batch. */
const IP = '203.0.113.7';

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    insert_id: '018f6b2e-7c1a-7f3b-9c4d-1a2b3c4d5e6f',
    event: 'checkout_completed',
    distinct_id: 'u_42',
    anon_id: '018f6b2e-aaaa-7f3b-9c4d-1a2b3c4d5e6f',
    session_id: '018f6b2e-bbbb-7f3b-9c4d-1a2b3c4d5e6f',
    timestamp: NOW - 1000,
    properties: { plan: 'pro', value: 9.99 },
    context: { os: 'ios', app_version: '1.4.2', screen_width: 393, utm_content: null },
    ...overrides,
  };
}

describe('clampTimestamp', () => {
  it('passes through in-range timestamps', () => {
    expect(clampTimestamp(NOW - 1000, NOW)).toBe(NOW - 1000);
  });

  it('clamps timestamps older than 7 days to now-7d', () => {
    expect(clampTimestamp(0, NOW)).toBe(NOW - TIMESTAMP_PAST_LIMIT_MS);
  });

  it('clamps timestamps more than 5 minutes ahead to now+5min', () => {
    expect(clampTimestamp(NOW + 3_600_000, NOW)).toBe(NOW + TIMESTAMP_FUTURE_LIMIT_MS);
  });

  it('accepts exactly now-7d unchanged (inclusive lower edge)', () => {
    const edge = NOW - TIMESTAMP_PAST_LIMIT_MS;
    expect(clampTimestamp(edge, NOW)).toBe(edge);
  });

  it('clamps one ms older than now-7d to now-7d', () => {
    const edge = NOW - TIMESTAMP_PAST_LIMIT_MS;
    expect(clampTimestamp(edge - 1, NOW)).toBe(edge);
  });

  it('accepts exactly now+5min unchanged (inclusive upper edge)', () => {
    const edge = NOW + TIMESTAMP_FUTURE_LIMIT_MS;
    expect(clampTimestamp(edge, NOW)).toBe(edge);
  });

  it('clamps one ms beyond now+5min to now+5min', () => {
    const edge = NOW + TIMESTAMP_FUTURE_LIMIT_MS;
    expect(clampTimestamp(edge + 1, NOW)).toBe(edge);
  });
});

describe('EventNormalizer.normalizeBatch', () => {
  const normalizer = new EventNormalizer();

  it('maps a valid event to a ClickHouse row with authoritative server_timestamp', () => {
    const { rows, rejected } = normalizer.normalizeBatch(PROJECT_ID, [makeEvent()], 'client', IP, NOW);
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      project_id: PROJECT_ID,
      insert_id: '018f6b2e-7c1a-7f3b-9c4d-1a2b3c4d5e6f',
      event: 'checkout_completed',
      distinct_id: 'u_42',
      timestamp: '2026-07-02 11:59:59.000',
      server_timestamp: '2026-07-02 12:00:00.000',
      properties: { plan: 'pro', value: 9.99 },
      os: 'ios',
      app_version: '1.4.2',
      screen_width: 393,
      utm_content: '',
    });
  });

  // A payload `source` is not a validation error, it is simply not a field: zod drops the unknown
  // key and the token's value is used. Rejecting it instead would leak that the field once meant
  // something, and would break any SDK build still sending it.
  it('accepts an item carrying a junk source and stamps the token value anyway', () => {
    const { rows, rejected } = normalizer.normalizeBatch(
      PROJECT_ID,
      [makeEvent({ source: 'robot' })],
      'client',
      IP,
      NOW,
    );
    expect(rejected).toEqual([]);
    expect(rows[0].source).toBe('client');
  });

  it('fills contract defaults for missing context and properties', () => {
    const { rows } = normalizer.normalizeBatch(
      PROJECT_ID,
      [makeEvent({ properties: undefined, context: undefined })],
      'client',
      IP,
      NOW,
    );
    expect(rows[0].properties).toEqual({});
    expect(rows[0].os).toBe('');
    expect(rows[0].screen_width).toBe(0);
    expect(rows[0].install_referrer).toBe('');
    // A pre-device-context SDK sends none of these; the columns are NOT NULL.
    expect(rows[0].device_id).toBe('');
    expect(rows[0].device_token).toBe('');
    expect(rows[0].unique_id).toBe('');
    expect(rows[0].theme).toBe('');
  });

  it('carries the device identity and appearance context onto the row', () => {
    const { rows } = normalizer.normalizeBatch(
      PROJECT_ID,
      [
        makeEvent({
          context: {
            device_id: 'IDFV-1111',
            device_token: 'fcm-token-abc',
            unique_id: 'phone-mark-1',
            theme: 'dark',
          },
        }),
      ],
      'client',
      IP,
      NOW,
    );
    expect(rows[0].device_id).toBe('IDFV-1111');
    expect(rows[0].device_token).toBe('fcm-token-abc');
    expect(rows[0].unique_id).toBe('phone-mark-1');
    expect(rows[0].theme).toBe('dark');
  });

  it('rejects an item missing insert_id with the contract reason style', () => {
    const { insert_id, ...bad } = makeEvent();
    const { rows, rejected } = normalizer.normalizeBatch(PROJECT_ID, [bad], 'client', IP, NOW);
    expect(rows).toEqual([]);
    expect(rejected).toEqual([{ index: 0, reason: 'missing insert_id' }]);
  });

  it('rejects an item with a non-uuid insert_id naming the field', () => {
    const { rejected } = normalizer.normalizeBatch(
      PROJECT_ID,
      [makeEvent({ insert_id: 'nope' })],
      'client',
      IP,
      NOW,
    );
    expect(rejected[0].reason).toMatch(/^insert_id/);
  });

  it('accepts valid items around rejected ones — never all-or-nothing', () => {
    const good1 = makeEvent();
    const good2 = makeEvent({ insert_id: randomUUID() });
    const { rows, rejected } = normalizer.normalizeBatch(
      PROJECT_ID,
      [good1, { event: 'orphan' }, good2],
      'client',
      IP,
      NOW,
    );
    expect(rows).toHaveLength(2);
    expect(rejected).toEqual([{ index: 1, reason: 'missing insert_id' }]);
  });

  it('stamps the token source onto every row of the batch', () => {
    const { rows } = normalizer.normalizeBatch(
      PROJECT_ID,
      [makeEvent(), makeEvent({ insert_id: randomUUID() })],
      'server',
      IP,
      NOW,
    );
    expect(rows.map((row) => row.source)).toEqual(['server', 'server']);
  });

  it('ignores a source the payload tries to claim for itself — the token decides', () => {
    const { rows } = normalizer.normalizeBatch(
      PROJECT_ID,
      [makeEvent({ source: 'server', context: { source: 'server' } })],
      'client',
      IP,
      NOW,
    );
    expect(rows[0].source).toBe('client');
    // ...and it does not leak into the property bag either.
    expect(rows[0].properties).not.toHaveProperty('source');
  });

  it('stamps the connection address onto every row, and takes none from the payload', () => {
    const { rows } = normalizer.normalizeBatch(
      PROJECT_ID,
      [makeEvent({ context: { ip: '10.0.0.1' } }), makeEvent({ insert_id: randomUUID() })],
      'client',
      IP,
      NOW,
    );
    expect(rows.map((row) => row.ip)).toEqual([IP, IP]);
    // An `ip` the app put in its context is an unknown key: dropped, never stored as a property.
    expect(rows[0].properties).not.toHaveProperty('ip');
  });

  it('keeps NO address for a server token — that connection is a backend, not a device', () => {
    // Storing it would stamp one backend's egress IP onto every user it writes about, and show it
    // in the dashboard under "Device properties" as though it were the user's own device.
    const { rows } = normalizer.normalizeBatch(PROJECT_ID, [makeEvent()], 'server', IP, NOW);
    expect(rows[0].ip).toBe('');
  });

  it('clamps stale client timestamps to now-7d in the emitted row', () => {
    const { rows } = normalizer.normalizeBatch(
      PROJECT_ID,
      [makeEvent({ timestamp: 1 })],
      'client',
      IP,
      NOW,
    );
    expect(rows[0].timestamp).toBe('2026-06-25 12:00:00.000');
  });
});
