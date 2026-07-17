import { FlowUnitRow, buildFlowGraph, compileFlowQuery } from './flows.compiler';
import type { FlowsQuery } from './flows.schema';
import type { FlowLink, FlowNode } from '../../analytics.types';

const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';

function baseQuery(overrides: Partial<FlowsQuery> = {}): FlowsQuery {
  return {
    anchor: { event: 'home', filters: [] },
    direction: 'forward',
    date_range: { from: '2026-06-01', to: '2026-07-01' },
    steps: 3,
    max_nodes_per_step: 8,
    unit: 'session',
    ...overrides,
  };
}

/** Builds a time-ordered unit row; the anchor flag is set on every occurrence of `anchorEvent`. */
function makeUnit(did: string, events: string[], anchorEvent: string): FlowUnitRow {
  return {
    did,
    seq: events.map((event, i) => [i * 1000, event, event === anchorEvent ? 1 : 0]),
  };
}

function nodeValue(nodes: FlowNode[], id: string): number | undefined {
  return nodes.find((n) => n.id === id)?.value;
}
function linkValue(links: FlowLink[], source: string, target: string): number | undefined {
  return links.find((l) => l.source === source && l.target === target)?.value;
}

describe('compileFlowQuery (contracts §15)', () => {
  it('splits by session_id (unit=session), orders by time, flags the anchor, all bound + scoped', () => {
    const { sql, params } = compileFlowQuery(baseQuery({ unit: 'session' }), PROJECT_ID);
    expect(sql).toContain('session_id AS unit_id');
    expect(sql).toContain('arraySort(x -> x.1, groupArray((toUnixTimestamp64Milli(timestamp), event, is_anchor)))');
    expect(sql).toContain('toUInt8(event = {anchorEvent:String}) AS is_anchor');
    expect(sql).toContain('project_id = {projectId:UUID}');
    expect(sql).toContain('timestamp >= {from:DateTime64}');
    expect(sql).toContain('HAVING max(is_anchor) = 1');
    expect(params.anchorEvent).toBe('home');
  });

  it('unit=user splits by distinct_id, from the frozen map', () => {
    const { sql } = compileFlowQuery(baseQuery({ unit: 'user' }), PROJECT_ID);
    expect(sql).toContain('distinct_id AS unit_id');
  });

  it('anchor filters are ANDed into is_anchor inside the single-table subquery', () => {
    const { sql, params } = compileFlowQuery(
      baseQuery({ anchor: { event: 'home', filters: [{ property: 'os', op: 'eq', value: 'ios' }] } }),
      PROJECT_ID,
    );
    expect(sql).toContain('toUInt8(event = {anchorEvent:String} AND os = {filterVal0:String}) AS is_anchor');
    expect(params.filterVal0).toBe('ios');
  });

  describe('INJECTION', () => {
    it('a malicious anchor event name / filter value is bound, never inlined', () => {
      const attack = "'; DROP TABLE events; --";
      const { sql, params } = compileFlowQuery(
        baseQuery({ anchor: { event: attack, filters: [{ property: 'plan', op: 'eq', value: attack }] } }),
        PROJECT_ID,
      );
      expect(params.anchorEvent).toBe(attack);
      expect(params.filterVal0).toBe(attack);
      expect(sql).not.toContain(attack);
      expect(sql).not.toContain('DROP TABLE');
    });
  });
});

describe('buildFlowGraph (contracts §15)', () => {
  // Known branching dataset (forward from `home`):
  //  fu1: home -> browse -> checkout   fu2: home -> browse -> checkout
  //  fu3: home -> browse (drop)        fu4: home -> search (drop)      fu5: home (drop)
  const dataset: FlowUnitRow[] = [
    makeUnit('fu1', ['home', 'browse', 'checkout'], 'home'),
    makeUnit('fu2', ['home', 'browse', 'checkout'], 'home'),
    makeUnit('fu3', ['home', 'browse'], 'home'),
    makeUnit('fu4', ['home', 'search'], 'home'),
    makeUnit('fu5', ['home'], 'home'),
  ];

  it('forward: exact node values incl $end drop-offs (steps=2, no folding)', () => {
    const { nodes } = buildFlowGraph(dataset, { direction: 'forward', steps: 2, maxNodesPerStep: 8 });
    expect(nodeValue(nodes, '0:home')).toBe(5);
    expect(nodeValue(nodes, '1:browse')).toBe(3);
    expect(nodeValue(nodes, '1:search')).toBe(1);
    expect(nodeValue(nodes, '1:$end')).toBe(1); // fu5 dropped at step 1
    expect(nodeValue(nodes, '2:checkout')).toBe(2);
    expect(nodeValue(nodes, '2:$end')).toBe(2); // fu3 + fu4 dropped at step 2
  });

  it('forward: exact link values (Sankey), incl anchor -> $end', () => {
    const { links } = buildFlowGraph(dataset, { direction: 'forward', steps: 2, maxNodesPerStep: 8 });
    expect(linkValue(links, '0:home', '1:browse')).toBe(3);
    expect(linkValue(links, '0:home', '1:search')).toBe(1);
    expect(linkValue(links, '0:home', '1:$end')).toBe(1);
    expect(linkValue(links, '1:browse', '2:checkout')).toBe(2);
    expect(linkValue(links, '1:browse', '2:$end')).toBe(1);
    expect(linkValue(links, '1:search', '2:$end')).toBe(1);
  });

  it('folds the low-volume tail into $other when max_nodes_per_step is exceeded', () => {
    const { nodes, links } = buildFlowGraph(dataset, {
      direction: 'forward',
      steps: 2,
      maxNodesPerStep: 1, // keep only the top event (browse) at step 1; search -> $other
    });
    expect(nodeValue(nodes, '1:browse')).toBe(3);
    expect(nodeValue(nodes, '1:$other')).toBe(1); // search folded
    expect(nodeValue(nodes, '1:$end')).toBe(1);
    expect(linkValue(links, '0:home', '1:$other')).toBe(1);
    // the folded from-node carries its downstream transition too
    expect(linkValue(links, '1:$other', '2:$end')).toBe(1);
  });

  it('backward: walks preceding events; missing prior event -> $end', () => {
    const back: FlowUnitRow[] = [
      makeUnit('fb1', ['p', 'q', 'home'], 'home'),
      makeUnit('fb2', ['home'], 'home'), // no prior event -> drop-off
    ];
    const { nodes, links } = buildFlowGraph(back, { direction: 'backward', steps: 2, maxNodesPerStep: 8 });
    expect(nodeValue(nodes, '0:home')).toBe(2);
    expect(linkValue(links, '0:home', '1:q')).toBe(1);
    expect(linkValue(links, '1:q', '2:p')).toBe(1);
    expect(nodeValue(nodes, '2:p')).toBe(1);
    expect(linkValue(links, '0:home', '1:$end')).toBe(1); // fb2
  });

  it('counts a user once per node/link even across repeated anchor occurrences (uniqExact)', () => {
    const repeated: FlowUnitRow[] = [makeUnit('u', ['home', 'browse', 'home', 'browse'], 'home')];
    const { nodes } = buildFlowGraph(repeated, { direction: 'forward', steps: 1, maxNodesPerStep: 8 });
    expect(nodeValue(nodes, '0:home')).toBe(1);
    expect(nodeValue(nodes, '1:browse')).toBe(1);
  });
});
