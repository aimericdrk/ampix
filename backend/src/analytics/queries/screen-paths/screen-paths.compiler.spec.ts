import { buildFlowGraph, FlowUnitRow } from '../flows/flows.compiler';
import { compileScreenPathQuery, markEntryAnchors } from './screen-paths.compiler';
import type { ScreenPathsQuery } from './screen-paths.schema';

const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';

function baseQuery(overrides: Partial<ScreenPathsQuery> = {}): ScreenPathsQuery {
  return {
    direction: 'forward',
    date_range: { from: '2026-06-01', to: '2026-07-01' },
    steps: 3,
    max_nodes_per_step: 8,
    unit: 'session',
    ...overrides,
  };
}

/** Builds a time-ordered screen sequence for one unit (all is_anchor=0, as the no-anchor SQL emits). */
function makeUnit(did: string, screens: string[]): FlowUnitRow {
  return { did, seq: screens.map((screen, i) => [i * 1000, screen, 0]) };
}

describe('compileScreenPathQuery (contracts §19)', () => {
  it('reads $screen_name of $screen_view, canonicalizes to uid, splits by session', () => {
    const { sql, params, settings } = compileScreenPathQuery(baseQuery({ unit: 'session' }), PROJECT_ID);

    expect(sql).toContain('WITH aliases AS');
    expect(sql).toContain("e.event = '$screen_view'");
    expect(sql).toContain("JSONExtractString(toJSONString(e.properties), '$screen_name') AS screen");
    expect(sql).toContain('e.session_id AS unit_id');
    expect(sql).toContain('coalesce(aliases.canonical_id, e.distinct_id) AS did');
    expect(sql).toContain('arraySort(x -> x.1, groupArray((ms, screen, is_anchor)))');
    expect(params.projectId).toBe(PROJECT_ID);
    // §17: the canonicalizing join needs join_use_nulls=1.
    expect(settings).toEqual({ join_use_nulls: 1 });
  });

  it('unit=user splits by the canonical uid', () => {
    const { sql } = compileScreenPathQuery(baseQuery({ unit: 'user' }), PROJECT_ID);
    expect(sql).toContain('coalesce(aliases.canonical_id, e.distinct_id) AS unit_id');
  });

  it('with anchor_screen: flags visits in SQL and keeps only units that visited it', () => {
    const { sql, params } = compileScreenPathQuery(baseQuery({ anchor_screen: 'home' }), PROJECT_ID);
    expect(sql).toContain(
      "toUInt8(JSONExtractString(toJSONString(e.properties), '$screen_name') = {anchorScreen:String})",
    );
    expect(sql).toContain('HAVING max(is_anchor) = 1');
    expect(params.anchorScreen).toBe('home');
  });

  it('without anchor_screen: is_anchor is 0 in SQL (entry marked in TS), no HAVING', () => {
    const { sql, params } = compileScreenPathQuery(baseQuery(), PROJECT_ID);
    expect(sql).toContain('toUInt8(0) AS is_anchor');
    expect(sql).not.toContain('HAVING');
    expect(params.anchorScreen).toBeUndefined();
  });

  describe('§17 identity-correct per-user filter (distinct_ids)', () => {
    it('adds a bound Array(String) IN filter on e.distinct_id when distinct_ids is present', () => {
      const { sql, params } = compileScreenPathQuery(
        baseQuery({ distinct_ids: ['u1', 'anon1'] }),
        PROJECT_ID,
      );
      expect(sql).toContain('e.distinct_id IN {distinctIds:Array(String)}');
      expect(params.distinctIds).toEqual(['u1', 'anon1']);
    });

    it('omits the identity filter entirely when distinct_ids is absent', () => {
      const { sql, params } = compileScreenPathQuery(baseQuery(), PROJECT_ID);
      expect(sql).not.toContain('distinct_id IN');
      expect(params.distinctIds).toBeUndefined();
    });

    it('omits the identity filter when distinct_ids is an empty array', () => {
      const { sql, params } = compileScreenPathQuery(baseQuery({ distinct_ids: [] }), PROJECT_ID);
      expect(sql).not.toContain('distinct_id IN');
      expect(params.distinctIds).toBeUndefined();
    });
  });

  describe('INJECTION', () => {
    it('a malicious anchor_screen is bound, never inlined', () => {
      const attack = "'; DROP TABLE events; --";
      const { sql, params } = compileScreenPathQuery(baseQuery({ anchor_screen: attack }), PROJECT_ID);
      expect(params.anchorScreen).toBe(attack);
      expect(sql).not.toContain(attack);
      expect(sql).not.toContain('DROP TABLE');
    });

    it('a distinct_id containing SQL metacharacters stays only in params, never in the SQL', () => {
      const attack = "'; DROP TABLE events; --";
      const { sql, params } = compileScreenPathQuery(
        baseQuery({ distinct_ids: ['u1', attack] }),
        PROJECT_ID,
      );
      expect(params.distinctIds).toEqual(['u1', attack]);
      expect(sql).toContain('e.distinct_id IN {distinctIds:Array(String)}');
      expect(sql).not.toContain(attack);
      expect(sql).not.toContain('DROP TABLE');
    });
  });
});

describe('markEntryAnchors + buildFlowGraph (screen entry paths, contracts §19)', () => {
  it('marks each unit’s first screen as the anchor so paths start at the entry screen', () => {
    const rows = [makeUnit('s1', ['home', 'browse', 'cart'])];
    const [marked] = markEntryAnchors(rows);
    expect(marked.seq.map((t) => t[2])).toEqual([1, 0, 0]);
  });

  it('produces an exact entry-screen Sankey incl. the $end drop-off', () => {
    // Two sessions entering on `home`, one on `search`; forward 2 hops.
    const rows = markEntryAnchors([
      makeUnit('s1', ['home', 'browse', 'checkout']),
      makeUnit('s2', ['home', 'browse']),
      makeUnit('s3', ['search', 'browse']),
    ]);
    const { nodes, links } = buildFlowGraph(rows, {
      direction: 'forward',
      steps: 2,
      maxNodesPerStep: 8,
    });
    const nodeVal = (id: string) => nodes.find((n) => n.id === id)?.value;
    const linkVal = (s: string, t: string) =>
      links.find((l) => l.source === s && l.target === t)?.value;

    expect(nodeVal('0:home')).toBe(2); // two entry sessions on home
    expect(nodeVal('0:search')).toBe(1);
    expect(linkVal('0:home', '1:browse')).toBe(2);
    expect(linkVal('1:browse', '2:checkout')).toBe(1); // s1
    expect(linkVal('1:browse', '2:$end')).toBe(2); // s2 (from home) + s3 (from search) drop off
  });
});
