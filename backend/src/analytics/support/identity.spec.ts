import {
  ALIASES_CTE,
  CANONICAL_JOIN_SETTINGS,
  RESOLVE_CANONICAL_ID_SQL,
  canonicalization,
} from './identity';

/** Every `{name:Type}` param placeholder in a SQL fragment. */
function paramPlaceholders(sql: string): string[] {
  return sql.match(/\{[^}]+\}/g) ?? [];
}

describe('identity canonicalization SQL builder (contracts §17)', () => {
  describe('aliases CTE', () => {
    it('is the latest-canonical-id-per-anon map scoped to the project', () => {
      expect(ALIASES_CTE).toContain('FROM identity_mappings');
      expect(ALIASES_CTE).toContain('argMax(canonical_id, created_at) AS canonical_id');
      expect(ALIASES_CTE).toContain('GROUP BY project_id, anon_id');
    });

    it('binds project scoping as a param and interpolates NOTHING else', () => {
      // The ONLY placeholder is the bound project id — no user-derived literal is ever spliced in.
      expect(paramPlaceholders(ALIASES_CTE)).toEqual(['{projectId:UUID}']);
    });
  });

  describe('canonicalization()', () => {
    it('defaults to joining `events AS e` and coalescing to the canonical id', () => {
      const canon = canonicalization();
      expect(canon.cte).toBe(ALIASES_CTE);
      expect(canon.join).toBe('LEFT JOIN aliases ON e.distinct_id = aliases.anon_id');
      expect(canon.uid).toBe('coalesce(aliases.canonical_id, e.distinct_id)');
    });

    it('accepts a subquery distinct_id reference (insights `unique_users` path)', () => {
      const canon = canonicalization('ev.distinct_id');
      expect(canon.join).toBe('LEFT JOIN aliases ON ev.distinct_id = aliases.anon_id');
      expect(canon.uid).toBe('coalesce(aliases.canonical_id, ev.distinct_id)');
    });

    it('requires join_use_nulls=1 so coalesce is correct for already-identified users', () => {
      expect(canonicalization().settings).toEqual(CANONICAL_JOIN_SETTINGS);
      expect(CANONICAL_JOIN_SETTINGS).toEqual({ join_use_nulls: 1 });
    });

    it('emits only the bound project param — never any user input — in its whole fragment', () => {
      const canon = canonicalization();
      const combined = `${canon.cte}\n${canon.join}\n${canon.uid}`;
      expect(paramPlaceholders(combined)).toEqual(['{projectId:UUID}']);
    });
  });

  describe('RESOLVE_CANONICAL_ID_SQL', () => {
    it('binds both the project and the requested id as params (never interpolated)', () => {
      expect(RESOLVE_CANONICAL_ID_SQL).toContain('argMax(canonical_id, created_at)');
      expect(RESOLVE_CANONICAL_ID_SQL).toContain('anon_id = {distinctId:String}');
      expect(paramPlaceholders(RESOLVE_CANONICAL_ID_SQL).sort()).toEqual([
        '{distinctId:String}',
        '{projectId:UUID}',
      ]);
    });
  });
});
