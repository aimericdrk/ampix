import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { RcIdentityService } from './rc-identity.service';

function chMock(handler: (sql: string) => unknown[]) {
  return { query: jest.fn(async (sql: string) => handler(sql)) } as unknown as ClickHouseService;
}

describe('RcIdentityService.resolveDistinctId', () => {
  it('prefers the latest explicit $rc_link', async () => {
    const ch = chMock((sql) => (sql.includes("$rc_link") ? [{ distinct_id: 'linked-user' }] : []));
    const svc = new RcIdentityService(ch);
    await expect(svc.resolveDistinctId('pid', 'rc-app-user')).resolves.toBe('linked-user');
  });

  it('falls back to identity_mappings canonical id (convention: app_user_id was an anon id)', async () => {
    const ch = chMock((sql) => {
      if (sql.includes("$rc_link")) return [];
      if (sql.includes('identity_mappings')) return [{ canonical_id: 'canonical-user' }];
      return [];
    });
    const svc = new RcIdentityService(ch);
    await expect(svc.resolveDistinctId('pid', 'rc-app-user')).resolves.toBe('canonical-user');
  });

  it('falls back to the app_user_id itself when it exists as a distinct_id in events', async () => {
    const ch = chMock((sql) => {
      if (sql.includes("$rc_link") || sql.includes('identity_mappings')) return [];
      return [{ one: 1 }]; // presence probe
    });
    const svc = new RcIdentityService(ch);
    await expect(svc.resolveDistinctId('pid', 'known-distinct')).resolves.toBe('known-distinct');
  });

  it('returns null when nothing matches, and never resolves $RCAnonymousID via convention', async () => {
    const ch = chMock(() => []);
    const svc = new RcIdentityService(ch);
    await expect(svc.resolveDistinctId('pid', 'ghost')).resolves.toBeNull();
    const probing = chMock((sql) => (sql.includes("$rc_link") ? [] : [{ one: 1 }]));
    const svc2 = new RcIdentityService(probing);
    await expect(svc2.resolveDistinctId('pid', '$RCAnonymousID:abc')).resolves.toBeNull();
  });

  it('binds the app_user_id as a query param (never interpolates)', async () => {
    const ch = chMock(() => []);
    const svc = new RcIdentityService(ch);
    await svc.resolveDistinctId('pid', "evil'--");
    for (const call of (ch.query as jest.Mock).mock.calls) {
      expect(call[0]).not.toContain("evil'--");
      expect(call[1]).toMatchObject({ appUserId: "evil'--" });
    }
  });
});
