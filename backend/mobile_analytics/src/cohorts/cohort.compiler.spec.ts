import { toChDateTime64 } from '../clickhouse/clickhouse.service';
import { compileCohort } from './cohort.compiler';
import { CohortDefinition, cohortDefinitionSchema } from './cohort.schema';

const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';
const NOW = Date.UTC(2026, 6, 2, 12, 0, 0); // fixed clock so `within_days` windows are deterministic
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function def(definition: unknown): CohortDefinition {
  return cohortDefinitionSchema.parse(definition);
}

function compile(definition: unknown) {
  return compileCohort(def(definition), PROJECT_ID, { now: NOW });
}

describe('compileCohort (contracts §16)', () => {
  it('scopes every condition by the bound project id', () => {
    const { sql, params } = compile({
      match: 'all',
      conditions: [{ type: 'behavior', event: 'checkout', op: 'gte', count: 1, within_days: 30 }],
    });
    expect(sql).toContain('project_id = {cohortProjectId:UUID}');
    expect(params.cohortProjectId).toBe(PROJECT_ID);
  });

  describe('behavior condition', () => {
    it('compiles to GROUP BY distinct_id HAVING count() {op} {n}, all bound', () => {
      const { sql, params } = compile({
        match: 'all',
        conditions: [
          { type: 'behavior', event: 'checkout_completed', op: 'gte', count: 3, within_days: 30 },
        ],
      });
      expect(sql).toContain('SELECT distinct_id');
      expect(sql).toContain('event = {c0Event:String}');
      expect(sql).toContain('timestamp >= {c0Since:DateTime64}');
      expect(sql).toContain('GROUP BY distinct_id');
      expect(sql).toContain('HAVING count(DISTINCT insert_id) >= {c0Count:UInt64}');
      expect(params.c0Event).toBe('checkout_completed');
      expect(params.c0Count).toBe(3);
      // event name/count never inlined
      expect(sql).not.toContain('checkout_completed');
      expect(sql).not.toContain(' 3');
    });

    it('derives the window bound from `within_days` relative to `now`', () => {
      const { params } = compile({
        match: 'all',
        conditions: [{ type: 'behavior', event: 'e', op: 'gt', count: 0, within_days: 7 }],
      });
      expect(params.c0Since).toBe(toChDateTime64(NOW - 7 * MS_PER_DAY));
    });

    it.each([
      ['gte', '>='],
      ['gt', '>'],
      ['lte', '<='],
      ['lt', '<'],
      ['eq', '='],
    ])('selects the SQL operator for %s from the frozen map, never raw input', (op, sqlOp) => {
      const { sql } = compile({
        match: 'all',
        conditions: [{ type: 'behavior', event: 'e', op, count: 2, within_days: 30 }],
      });
      expect(sql).toContain(`HAVING count(DISTINCT insert_id) ${sqlOp} {c0Count:UInt64}`);
    });

    it('compiles per-step filters with a condition-scoped prefix (no collisions)', () => {
      const { sql, params } = compile({
        match: 'all',
        conditions: [
          {
            type: 'behavior',
            event: 'e',
            op: 'gte',
            count: 1,
            within_days: 30,
            filters: [{ property: 'os', op: 'eq', value: 'ios' }],
          },
        ],
      });
      expect(sql).toContain('os = {c0fVal0:String}');
      expect(params.c0fVal0).toBe('ios');
    });
  });

  describe('did_not condition', () => {
    it('compiles to countIf(<did predicate>) = 0 over all project users', () => {
      const { sql, params } = compile({
        match: 'all',
        conditions: [{ type: 'did_not', event: 'app_open', within_days: 7 }],
      });
      expect(sql).toContain('SELECT distinct_id');
      expect(sql).toContain('WHERE project_id = {cohortProjectId:UUID}');
      expect(sql).toContain('GROUP BY distinct_id');
      expect(sql).toContain(
        'HAVING countIf(event = {c0Event:String} AND timestamp >= {c0Since:DateTime64}) = 0',
      );
      expect(params.c0Event).toBe('app_open');
      expect(sql).not.toContain('app_open');
    });
  });

  describe('property condition', () => {
    it('resolves a whitelisted column to a bare comparison (bound value)', () => {
      const { sql, params } = compile({
        match: 'all',
        conditions: [{ type: 'property', property: 'os', op: 'eq', value: 'ios' }],
      });
      expect(sql).toContain('AND os = {c0pVal0:String}');
      expect(params.c0pVal0).toBe('ios');
      expect(params).not.toHaveProperty('c0pKey0'); // whitelist hit needs no bound key
    });

    it('resolves a custom property to a bound JSONExtract key + value', () => {
      const { sql, params } = compile({
        match: 'all',
        conditions: [{ type: 'property', property: 'plan', op: 'eq', value: 'pro' }],
      });
      expect(sql).toContain('JSONExtractString(toJSONString(properties), {c0pKey0:String})');
      expect(params.c0pKey0).toBe('plan');
      expect(params.c0pVal0).toBe('pro');
      // Neither the key nor the value is inlined as a SQL literal (they are bound params).
      expect(sql).not.toContain('plan');
      expect(sql).not.toContain("'pro'");
      expect(sql).not.toContain('= pro');
    });
  });

  describe('profile condition', () => {
    it('compiles a profile condition to a user_profiles subquery with bound params', () => {
      const { sql, params } = compile({
        match: 'all',
        conditions: [{ type: 'profile', property: '$rc_status', op: 'eq', value: 'active' }],
      });
      expect(sql).toContain('FROM user_profiles FINAL');
      expect(sql).toContain('WHERE project_id = {cohortProjectId:UUID}');
      expect(sql).toContain('JSONExtractString(toJSONString(properties), {c0Key:String})');
      expect(params.c0Key).toBe('$rc_status');
      expect(params.c0Val).toBe('active');
      expect(sql).not.toContain('active');
      expect(sql).not.toContain('$rc_status');
    });

    it('supports is_set without a bound value param', () => {
      const { sql, params } = compile({
        match: 'all',
        conditions: [{ type: 'profile', property: '$rc_status', op: 'is_set' }],
      });
      expect(sql).toContain("!= ''");
      expect(params.c0Key).toBe('$rc_status');
      expect(params).not.toHaveProperty('c0Val');
    });

    it('composes under match:all as an INTERSECT with other condition subqueries', () => {
      const { sql } = compile({
        match: 'all',
        conditions: [
          { type: 'profile', property: '$rc_status', op: 'eq', value: 'active' },
          { type: 'behavior', event: 'app_open', op: 'gte', count: 1, within_days: 30 },
        ],
      });
      expect(sql).toContain('INTERSECT');
      expect(sql).toContain('FROM user_profiles FINAL');
      expect(sql).not.toContain('UNION');
    });

    it('composes under match:any as a UNION DISTINCT with other condition subqueries', () => {
      const { sql } = compile({
        match: 'any',
        conditions: [
          { type: 'profile', property: '$rc_status', op: 'eq', value: 'active' },
          { type: 'did_not', event: 'app_open', within_days: 7 },
        ],
      });
      expect(sql).toContain('UNION DISTINCT');
      expect(sql).toContain('FROM user_profiles FINAL');
      expect(sql).not.toContain('INTERSECT');
    });

    it('per-condition params never collide with other conditions', () => {
      const { params } = compile({
        match: 'all',
        conditions: [
          { type: 'profile', property: '$rc_status', op: 'eq', value: 'active' },
          { type: 'property', property: 'plan', op: 'eq', value: 'pro' },
        ],
      });
      expect(params.c0Key).toBe('$rc_status');
      expect(params.c0Val).toBe('active');
      expect(params.c1pKey0).toBe('plan');
      expect(params.c1pVal0).toBe('pro');
    });
  });

  describe('match combinator', () => {
    it('all → INTERSECT of the per-condition id-sets', () => {
      const { sql } = compile({
        match: 'all',
        conditions: [
          { type: 'behavior', event: 'a', op: 'gte', count: 1, within_days: 30 },
          { type: 'property', property: 'plan', op: 'eq', value: 'pro' },
        ],
      });
      expect(sql).toContain('INTERSECT');
      expect(sql).not.toContain('UNION');
    });

    it('any → UNION DISTINCT of the per-condition id-sets', () => {
      const { sql } = compile({
        match: 'any',
        conditions: [
          { type: 'behavior', event: 'a', op: 'gte', count: 1, within_days: 30 },
          { type: 'did_not', event: 'b', within_days: 7 },
        ],
      });
      expect(sql).toContain('UNION DISTINCT');
      expect(sql).not.toContain('INTERSECT');
    });

    it('a single condition emits no set combinator', () => {
      const { sql } = compile({
        match: 'all',
        conditions: [{ type: 'behavior', event: 'a', op: 'gte', count: 1, within_days: 30 }],
      });
      expect(sql).not.toContain('INTERSECT');
      expect(sql).not.toContain('UNION');
    });

    it('per-condition params never collide across conditions', () => {
      const { params } = compile({
        match: 'all',
        conditions: [
          {
            type: 'behavior',
            event: 'a',
            op: 'gte',
            count: 1,
            within_days: 30,
            filters: [{ property: 'os', op: 'eq', value: 'ios' }],
          },
          {
            type: 'behavior',
            event: 'b',
            op: 'lt',
            count: 5,
            within_days: 30,
            filters: [{ property: 'os', op: 'eq', value: 'android' }],
          },
        ],
      });
      expect(params.c0Event).toBe('a');
      expect(params.c1Event).toBe('b');
      expect(params.c0fVal0).toBe('ios');
      expect(params.c1fVal0).toBe('android');
    });
  });

  describe('INJECTION', () => {
    it('a malicious behavior event name is bound, never present as raw SQL text', () => {
      const attack = "evt'; DROP TABLE events; --";
      const { sql, params } = compile({
        match: 'all',
        conditions: [{ type: 'behavior', event: attack, op: 'gte', count: 1, within_days: 30 }],
      });
      expect(params.c0Event).toBe(attack);
      expect(sql).not.toContain(attack);
      expect(sql).not.toContain('DROP TABLE');
    });

    it('a malicious did_not event name is bound, never inlined', () => {
      const attack = "x'; DELETE FROM events WHERE '1'='1";
      const { sql, params } = compile({
        match: 'all',
        conditions: [{ type: 'did_not', event: attack, within_days: 7 }],
      });
      expect(params.c0Event).toBe(attack);
      expect(sql).not.toContain(attack);
      expect(sql).not.toContain('DELETE FROM');
    });

    it('a malicious property value and Object.prototype property name are bound, never inlined', () => {
      const attack = "'; DROP TABLE events; --";
      const { sql, params } = compile({
        match: 'all',
        conditions: [{ type: 'property', property: '__proto__', op: 'eq', value: attack }],
      });
      // Object.prototype-inherited name resolves as a bound custom key, never a column.
      expect(params.c0pKey0).toBe('__proto__');
      expect(params.c0pVal0).toBe(attack);
      expect(sql).toContain('JSONExtractString(toJSONString(properties), {c0pKey0:String})');
      expect(sql).not.toContain(attack);
      expect(sql).not.toContain('DROP TABLE');
      // The stringified builtin must never leak into the SQL text.
      expect(sql).not.toContain('native code');
      expect(sql).not.toContain('[object');
    });

    it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
      'Object.prototype-inherited behavior-filter property %p is bound as a custom key, never a column',
      (proto) => {
        const { sql, params } = compile({
          match: 'all',
          conditions: [
            {
              type: 'behavior',
              event: 'e',
              op: 'gte',
              count: 1,
              within_days: 30,
              filters: [{ property: proto, op: 'eq', value: 'v' }],
            },
          ],
        });
        expect(params.c0fKey0).toBe(proto);
        expect(sql).toContain('JSONExtractString(toJSONString(properties), {c0fKey0:String})');
        expect(sql).not.toContain('native code');
        expect(sql).not.toContain('[object');
      },
    );
  });
});
