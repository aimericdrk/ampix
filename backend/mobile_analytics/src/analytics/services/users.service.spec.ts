import type { ClickHouseService } from '../../clickhouse/clickhouse.service';
import type { ProjectsService } from '../../projects/core/projects.service';
import type { UserAdminService } from './user-admin.service';
import { UsersService } from './users.service';

const USER = 'user-1';
const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';

/**
 * Focused on the §17 SOFT-REMOVE behaviour only — the identity/paging/search behaviour of these
 * endpoints is covered through the facade in `analytics.service.spec.ts`.
 */
function make(hiddenIds: string[], responses: unknown[][] = []) {
  const query = jest.fn((_sql: string, _params?: Record<string, unknown>) => Promise.resolve([]));
  responses.forEach((rows) => query.mockResolvedValueOnce(rows as never));
  const clickhouse = { query };
  const projects = { assertMembership: jest.fn().mockResolvedValue(undefined) };
  const hidden = { hiddenIds: jest.fn().mockResolvedValue(hiddenIds) };
  const service = new UsersService(
    clickhouse as unknown as ClickHouseService,
    projects as unknown as ProjectsService,
    hidden as unknown as UserAdminService,
  );
  return { service, clickhouse, hidden };
}

describe('UsersService — hidden users (§17 soft remove)', () => {
  describe('listUsers', () => {
    it('excludes hidden users by their CANONICAL id, bound as a param', async () => {
      const { service, clickhouse } = make(['staff-1', 'staff-2']);
      await service.listUsers(USER, PROJECT);
      const [sql, params] = clickhouse.query.mock.calls[0] as [string, Record<string, unknown>];
      expect(params.hiddenIds).toEqual(['staff-1', 'staff-2']);
      expect(sql).toContain(
        'coalesce(aliases.canonical_id, e.distinct_id) NOT IN {hiddenIds:Array(String)}',
      );
      // Never interpolated — an id is end-user-controlled text.
      expect(sql).not.toContain('staff-1');
    });

    it('emits no exclusion clause at all when nothing is hidden', async () => {
      const { service, clickhouse } = make([]);
      await service.listUsers(USER, PROJECT);
      const [sql, params] = clickhouse.query.mock.calls[0] as [string, Record<string, unknown>];
      expect(sql).not.toContain('hiddenIds');
      expect(params.hiddenIds).toBeUndefined();
    });

    it('still applies the caller\'s search alongside the exclusion', async () => {
      const { service, clickhouse } = make(['staff-1']);
      await service.listUsers(USER, PROJECT, 'ada');
      const [sql, params] = clickhouse.query.mock.calls[0] as [string, Record<string, unknown>];
      expect(params.search).toBe('ada');
      expect(params.hiddenIds).toEqual(['staff-1']);
      expect(sql).toContain('{hiddenIds:Array(String)}');
    });
  });

  describe('getLiveEvents', () => {
    it('drops a hidden user\'s rows from the feed', async () => {
      const { service, clickhouse } = make(['staff-1']);
      await service.getLiveEvents(USER, PROJECT);
      const [sql, params] = clickhouse.query.mock.calls[0] as [string, Record<string, unknown>];
      expect(params.hiddenIds).toEqual(['staff-1']);
      expect(sql).toContain('AND distinct_id NOT IN {hiddenIds:Array(String)}');
    });

    it('leaves the feed query untouched when nothing is hidden', async () => {
      const { service, clickhouse } = make([]);
      await service.getLiveEvents(USER, PROJECT);
      const [sql] = clickhouse.query.mock.calls[0] as [string];
      expect(sql).not.toContain('hiddenIds');
    });
  });

  describe('getUserProfile', () => {
    it('flags a hidden user rather than 404ing, so un-hide stays reachable', async () => {
      const { service } = make(['u1'], [
        [{ canonical_id: '' }], // id resolution: already canonical
        [], // profile
        [{ first_seen: '2026-06-01 09:00:00.000', last_seen: '2026-06-02 09:00:00.000', event_count: 3 }],
        [], // recent events
        [], // aliases
      ]);
      const result = await service.getUserProfile(USER, PROJECT, 'u1');
      expect(result.hidden).toBe(true);
      expect(result.event_count).toBe(3);
    });

    it('reports a visible user as not hidden', async () => {
      const { service } = make(['someone-else'], [
        [{ canonical_id: '' }],
        [],
        [{ first_seen: '2026-06-01 09:00:00.000', last_seen: '2026-06-02 09:00:00.000', event_count: 1 }],
        [],
        [],
      ]);
      const result = await service.getUserProfile(USER, PROJECT, 'u1');
      expect(result.hidden).toBe(false);
    });

    it('checks the CANONICAL id, so an anon id of a hidden user reads as hidden', async () => {
      const { service } = make(['u1'], [
        [{ canonical_id: 'u1' }], // 'anon-u1' resolves to 'u1'
        [],
        [{ first_seen: '2026-06-01 09:00:00.000', last_seen: '2026-06-02 09:00:00.000', event_count: 1 }],
        [],
        [],
      ]);
      const result = await service.getUserProfile(USER, PROJECT, 'anon-u1');
      expect(result.distinct_id).toBe('u1');
      expect(result.hidden).toBe(true);
    });
  });
});
