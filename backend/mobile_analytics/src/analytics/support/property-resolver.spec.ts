import { EVENT_COLUMN_WHITELIST, EVENT_SOURCE_EXPR, resolveProperty } from './property-resolver';

const WHITELIST_COLUMNS = [
  'event',
  'distinct_id',
  'anon_id',
  'session_id',
  'os',
  'os_version',
  'app_version',
  'app_build',
  'device_model',
  'device_manufacturer',
  'locale',
  'timezone',
  'network',
  'sdk_version',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'first_utm_source',
  'first_utm_campaign',
];

describe('resolveProperty', () => {
  it('exposes exactly the contracts §14 whitelist', () => {
    // `source` is whitelisted too, but resolves to a fixed expression, not a bare column.
    expect([...EVENT_COLUMN_WHITELIST].sort()).toEqual([...WHITELIST_COLUMNS, 'source'].sort());
  });

  it.each(WHITELIST_COLUMNS)(
    'resolves whitelisted column "%s" to the bare column identifier',
    (column) => {
      const params: Record<string, unknown> = {};
      const resolved = resolveProperty(column, 'someParam', params);

      expect(resolved).toEqual({ expr: column, isColumn: true });
      // A whitelist hit never needs (or creates) a bound key parameter.
      expect(params).toEqual({});
    },
  );

  it('resolves "source" to the fixed client/server expression with no bound param', () => {
    const params: Record<string, unknown> = {};
    const resolved = resolveProperty('source', 'someParam', params);

    expect(resolved).toEqual({ expr: EVENT_SOURCE_EXPR, isColumn: true });
    expect(params).toEqual({});
    // The expression is a fixed constant mapping '' (pre-column rows) via the historical
    // RevenueCat sdk_version stamp; both branches must be present.
    expect(EVENT_SOURCE_EXPR).toContain("'revenuecat-webhook'");
    expect(EVENT_SOURCE_EXPR).toContain("'client'");
    expect(EVENT_SOURCE_EXPR).toContain("'server'");
  });

  it('resolves a non-whitelisted property to a JSONExtractString(toJSONString(...)) call with the key bound as a param', () => {
    const params: Record<string, unknown> = {};
    const resolved = resolveProperty('plan', 'breakdownKey', params);

    expect(resolved.isColumn).toBe(false);
    expect(resolved.expr).toBe(
      'JSONExtractString(toJSONString(properties), {breakdownKey:String})',
    );
    expect(params).toEqual({ breakdownKey: 'plan' });
    // The raw property name must never appear inline in the expression string.
    expect(resolved.expr).not.toContain('plan');
  });

  it('INJECTION: a malicious property name is bound as a param value, never interpolated into the SQL expression', () => {
    const attack = "os'; DROP TABLE events; --";
    const params: Record<string, unknown> = {};
    const resolved = resolveProperty(attack, 'filterKey0', params);

    expect(resolved.isColumn).toBe(false);
    expect(params.filterKey0).toBe(attack);
    expect(resolved.expr).toBe('JSONExtractString(toJSONString(properties), {filterKey0:String})');
    expect(resolved.expr).not.toContain(attack);
    expect(resolved.expr).not.toContain('DROP TABLE');
  });

  it('INJECTION: a property name containing braces/backticks is still only ever bound as a param', () => {
    const attack = '`properties`}; SELECT {evil';
    const params: Record<string, unknown> = {};
    const resolved = resolveProperty(attack, 'breakdownKey', params);

    expect(params.breakdownKey).toBe(attack);
    expect(resolved.expr).not.toContain(attack);
    expect(resolved.expr).not.toContain('`');
  });

  it('an exact-looking-but-not-whitelisted property (e.g. trailing space) falls through to the custom-property path', () => {
    const params: Record<string, unknown> = {};
    const resolved = resolveProperty('os ', 'p', params);

    expect(resolved.isColumn).toBe(false);
    expect(params.p).toBe('os ');
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'])(
    'INJECTION: Object.prototype-inherited name %p resolves as a bound custom key, never a column',
    (proto) => {
      const params: Record<string, unknown> = {};
      const resolved = resolveProperty(proto, 'p', params);

      expect(resolved.isColumn).toBe(false);
      expect(params.p).toBe(proto);
      expect(resolved.expr).toBe('JSONExtractString(toJSONString(properties), {p:String})');
      // The stringified builtin must never leak into the SQL expression.
      expect(resolved.expr).not.toContain('native code');
      expect(resolved.expr).not.toContain('[object');
    },
  );
});
