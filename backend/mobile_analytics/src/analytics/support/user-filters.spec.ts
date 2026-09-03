import {
  compileUserFilters,
  compileUserIdentityFilter,
  parseUserFilters,
  parseUserIdentityFilter,
} from './user-filters';

const UID = "coalesce(aliases.canonical_id, e.distinct_id)";

describe('parseUserFilters', () => {
  it('reads a valid filter array', () => {
    expect(parseUserFilters('[{"property":"gender","op":"eq","value":"female"}]')).toEqual([
      { property: 'gender', op: 'eq', value: 'female' },
    ]);
  });

  it('treats absent and empty as no filters', () => {
    expect(parseUserFilters(undefined)).toEqual([]);
    expect(parseUserFilters('   ')).toEqual([]);
  });

  it('400s malformed JSON rather than passing it to ClickHouse', () => {
    expect(() => parseUserFilters('{oops')).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });

  it('400s an unknown operator', () => {
    expect(() => parseUserFilters('[{"property":"age","op":"between","value":3}]')).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });

  it('400s a comparison with no value, and allows is_set without one', () => {
    expect(() => parseUserFilters('[{"property":"age","op":"gt"}]')).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
    expect(parseUserFilters('[{"property":"age","op":"is_set"}]')).toEqual([
      { property: 'age', op: 'is_set' },
    ]);
  });

  it('caps how much WHERE clause one request can grow', () => {
    const many = JSON.stringify(
      Array.from({ length: 11 }, () => ({ property: 'age', op: 'is_set' })),
    );
    expect(() => parseUserFilters(many)).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });
});

describe('parseUserIdentityFilter', () => {
  it('defaults to all', () => {
    expect(parseUserIdentityFilter(undefined)).toBe('all');
    expect(parseUserIdentityFilter('')).toBe('all');
  });

  it('accepts the three known values and 400s anything else', () => {
    expect(parseUserIdentityFilter('identified')).toBe('identified');
    expect(parseUserIdentityFilter('anonymous')).toBe('anonymous');
    expect(() => parseUserIdentityFilter('robots')).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });
});

describe('compileUserFilters', () => {
  it('binds the property NAME and the value — neither is ever inlined', () => {
    const params: Record<string, unknown> = {};
    const [clause] = compileUserFilters(
      [{ property: "gender'; DROP TABLE user_profiles; --", op: 'eq', value: 'female' }],
      UID,
      params,
    );
    expect(clause).not.toContain('DROP TABLE');
    expect(params).toEqual({
      userFilterKey0: "gender'; DROP TABLE user_profiles; --",
      userFilterVal0: 'female',
    });
    expect(clause).toContain('{userFilterKey0:String}');
    expect(clause).toContain('FROM user_profiles FINAL');
  });

  it('scopes the match to the canonical id, so it follows a merged person', () => {
    const params: Record<string, unknown> = {};
    const [clause] = compileUserFilters([{ property: 'age', op: 'gt', value: 30 }], UID, params);
    expect(clause.startsWith(`${UID} IN (`)).toBe(true);
    expect(params.userFilterVal0).toBe(30);
  });

  it('indexes each filter so a second one cannot overwrite the first one\'s params', () => {
    const params: Record<string, unknown> = {};
    compileUserFilters(
      [
        { property: 'gender', op: 'eq', value: 'female' },
        { property: 'city', op: 'eq', value: 'Paris' },
      ],
      UID,
      params,
    );
    expect(params).toMatchObject({
      userFilterKey0: 'gender',
      userFilterVal0: 'female',
      userFilterKey1: 'city',
      userFilterVal1: 'Paris',
    });
  });
});

describe('compileUserIdentityFilter', () => {
  it('emits no clause at all for "all"', () => {
    expect(compileUserIdentityFilter('all', UID)).toBe('');
  });

  it('splits on whether the person can be CONTACTED — an email or a phone', () => {
    expect(compileUserIdentityFilter('identified', UID)).toContain(`${UID} IN (`);
    expect(compileUserIdentityFilter('anonymous', UID)).toContain(`${UID} NOT IN (`);
    const sql = compileUserIdentityFilter('identified', UID);
    // Every accepted spelling of both fields, matching what the list renders as the contact line.
    for (const key of ['email', '$email', 'phone', '$phone', 'phone_number', 'phoneNumber']) {
      expect(sql).toContain(`JSONExtractString(toJSONString(properties), '${key}') != ''`);
    }
  });

  it('does NOT count a profile that holds only demographics as identified', () => {
    const sql = compileUserIdentityFilter('identified', UID);
    // Knowing a user id is 34 and in Paris still leaves you with an id — which is the row an
    // operator filtering for "anonymous" is trying to find.
    expect(sql).not.toContain('JSONExtractKeys');
    for (const key of ['age', 'city', 'gender', 'name']) {
      expect(sql).not.toContain(`'${key}'`);
    }
  });
});
