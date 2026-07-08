import type { ProfileOperation } from '@myampix/contracts';
import type { ClickHouseService, ProfileRow } from '../clickhouse/clickhouse.service';
import { applyOperation, ProfileWriter } from './profile-writer';

const PROJECT_ID = '018f6b2e-0000-7000-8000-000000000001';
const NOW = Date.UTC(2026, 6, 2, 12, 0, 0, 0);

function op(partial: Partial<ProfileOperation> & Pick<ProfileOperation, 'op'>): ProfileOperation {
  return { distinct_id: 'u_1', timestamp: 1, ...partial } as ProfileOperation;
}

describe('applyOperation', () => {
  it('set overwrites and adds keys', () => {
    expect(
      applyOperation({ plan: 'free', a: 1 }, op({ op: 'set', properties: { plan: 'pro', b: 2 } })),
    ).toEqual({
      plan: 'pro',
      a: 1,
      b: 2,
    });
  });

  it('set_once only fills missing keys', () => {
    expect(
      applyOperation(
        { plan: 'free' },
        op({ op: 'set_once', properties: { plan: 'pro', source: 'ad' } }),
      ),
    ).toEqual({ plan: 'free', source: 'ad' });
  });

  it('increment adds to numeric values and starts absent keys from 0', () => {
    expect(
      applyOperation({ count: 2 }, op({ op: 'increment', properties: { count: 3, fresh: 5 } })),
    ).toEqual({
      count: 5,
      fresh: 5,
    });
  });

  it('increment treats non-numeric deltas and bases as 0', () => {
    expect(
      applyOperation(
        { count: 2, label: 'x' },
        op({ op: 'increment', properties: { count: 'nope', label: 3 } }),
      ),
    ).toEqual({
      count: 2,
      label: 3,
    });
  });

  it('append pushes onto arrays, creating them when absent', () => {
    expect(
      applyOperation({ tags: ['a'] }, op({ op: 'append', properties: { tags: 'b', other: 'x' } })),
    ).toEqual({
      tags: ['a', 'b'],
      other: ['x'],
    });
  });

  it('unset removes the named keys (values ignored)', () => {
    expect(applyOperation({ a: 1, b: 2 }, op({ op: 'unset', properties: { a: null } }))).toEqual({
      b: 2,
    });
  });

  it('delete clears the profile', () => {
    expect(applyOperation({ a: 1, b: 2 }, op({ op: 'delete' }))).toEqual({});
  });

  it('never mutates the input object', () => {
    const current = { a: 1 };
    applyOperation(current, op({ op: 'set', properties: { a: 2 } }));
    applyOperation(current, op({ op: 'unset', properties: { a: null } }));
    expect(current).toEqual({ a: 1 });
  });
});

describe('ProfileWriter.apply', () => {
  it('groups ops per distinct_id, applies them in timestamp order, writes one row per user', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const insertProfiles = jest.fn().mockResolvedValue(undefined);
    const writer = new ProfileWriter({ query, insertProfiles } as unknown as ClickHouseService);

    await writer.apply(
      PROJECT_ID,
      [
        { distinct_id: 'u_1', op: 'set', properties: { plan: 'free' }, timestamp: 2 },
        { distinct_id: 'u_1', op: 'set', properties: { plan: 'pro' }, timestamp: 1 }, // older — applied first
        { distinct_id: 'u_2', op: 'set', properties: { plan: 'max' }, timestamp: 3 },
      ],
      NOW,
    );

    expect(insertProfiles).toHaveBeenCalledTimes(1);
    const rows = insertProfiles.mock.calls[0][0] as ProfileRow[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.distinct_id === 'u_1')?.properties).toEqual({ plan: 'free' }); // ts=2 wins
    expect(rows.find((r) => r.distinct_id === 'u_2')?.properties).toEqual({ plan: 'max' });
    expect(rows[0].updated_at).toBe('2026-07-02 12:00:00.000');
  });

  it('merges onto the current profile fetched with FINAL', async () => {
    const query = jest.fn().mockResolvedValue([{ properties: { plan: 'free', seats: 1 } }]);
    const insertProfiles = jest.fn().mockResolvedValue(undefined);
    const writer = new ProfileWriter({ query, insertProfiles } as unknown as ClickHouseService);

    await writer.apply(
      PROJECT_ID,
      [{ distinct_id: 'u_1', op: 'increment', properties: { seats: 2 }, timestamp: 1 }],
      NOW,
    );

    expect(query.mock.calls[0][0]).toContain('FINAL');
    const rows = insertProfiles.mock.calls[0][0] as ProfileRow[];
    expect(rows[0].properties).toEqual({ plan: 'free', seats: 3 });
  });

  it('does nothing for an empty operation list', async () => {
    const query = jest.fn();
    const insertProfiles = jest.fn();
    const writer = new ProfileWriter({ query, insertProfiles } as unknown as ClickHouseService);
    await writer.apply(PROJECT_ID, [], NOW);
    expect(query).not.toHaveBeenCalled();
    expect(insertProfiles).not.toHaveBeenCalled();
  });
});
