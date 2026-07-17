import {
  cohortDefinitionSchema,
  createCohortSchema,
  updateCohortSchema,
} from './cohort.schema';

describe('cohortDefinitionSchema (contracts §16)', () => {
  const behavior = { type: 'behavior', event: 'checkout', op: 'gte', count: 1, within_days: 30 };
  const didNot = { type: 'did_not', event: 'app_open', within_days: 7 };
  const property = { type: 'property', property: 'plan', op: 'eq', value: 'pro' };

  it('accepts a definition mixing all three condition types', () => {
    const parsed = cohortDefinitionSchema.parse({
      match: 'all',
      conditions: [behavior, didNot, property],
    });
    expect(parsed.conditions).toHaveLength(3);
    // behavior/did_not filters default to [].
    expect((parsed.conditions[0] as { filters: unknown[] }).filters).toEqual([]);
  });

  it.each(['all', 'any'])('accepts match=%s', (match) => {
    expect(cohortDefinitionSchema.safeParse({ match, conditions: [behavior] }).success).toBe(true);
  });

  it('rejects an unknown match mode', () => {
    expect(cohortDefinitionSchema.safeParse({ match: 'most', conditions: [behavior] }).success).toBe(
      false,
    );
  });

  it('requires 1..10 conditions', () => {
    expect(cohortDefinitionSchema.safeParse({ match: 'all', conditions: [] }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, () => behavior);
    expect(cohortDefinitionSchema.safeParse({ match: 'all', conditions: eleven }).success).toBe(
      false,
    );
  });

  describe('behavior condition', () => {
    it('rejects an unknown count operator', () => {
      expect(
        cohortDefinitionSchema.safeParse({
          match: 'all',
          conditions: [{ ...behavior, op: 'between' }],
        }).success,
      ).toBe(false);
    });

    it('rejects a non-integer / negative count and within_days < 1', () => {
      expect(
        cohortDefinitionSchema.safeParse({ match: 'all', conditions: [{ ...behavior, count: 1.5 }] })
          .success,
      ).toBe(false);
      expect(
        cohortDefinitionSchema.safeParse({ match: 'all', conditions: [{ ...behavior, count: -1 }] })
          .success,
      ).toBe(false);
      expect(
        cohortDefinitionSchema.safeParse({
          match: 'all',
          conditions: [{ ...behavior, within_days: 0 }],
        }).success,
      ).toBe(false);
    });
  });

  describe('property condition', () => {
    it('requires a value for a comparison op', () => {
      expect(
        cohortDefinitionSchema.safeParse({
          match: 'all',
          conditions: [{ type: 'property', property: 'plan', op: 'eq' }],
        }).success,
      ).toBe(false);
    });

    it('allows is_set / is_not_set without a value', () => {
      expect(
        cohortDefinitionSchema.safeParse({
          match: 'all',
          conditions: [{ type: 'property', property: 'plan', op: 'is_set' }],
        }).success,
      ).toBe(true);
    });
  });

  describe('profile condition', () => {
    it('accepts a profile condition', () => {
      const parsed = cohortDefinitionSchema.parse({
        match: 'all',
        conditions: [{ type: 'profile', property: '$rc_status', op: 'eq', value: 'active' }],
      });
      expect(parsed.conditions[0]).toMatchObject({ type: 'profile', property: '$rc_status' });
    });

    it('requires a value for a comparison op', () => {
      expect(
        cohortDefinitionSchema.safeParse({
          match: 'all',
          conditions: [{ type: 'profile', property: '$rc_status', op: 'eq' }],
        }).success,
      ).toBe(false);
    });

    it('allows is_set / is_not_set without a value', () => {
      expect(
        cohortDefinitionSchema.safeParse({
          match: 'all',
          conditions: [{ type: 'profile', property: '$rc_status', op: 'is_set' }],
        }).success,
      ).toBe(true);
    });
  });
});

describe('createCohortSchema', () => {
  it('requires a name and a valid definition', () => {
    expect(
      createCohortSchema.safeParse({
        name: 'Power users',
        definition: {
          match: 'all',
          conditions: [{ type: 'behavior', event: 'e', op: 'gte', count: 1, within_days: 30 }],
        },
      }).success,
    ).toBe(true);
    expect(createCohortSchema.safeParse({ name: '', definition: {} }).success).toBe(false);
  });
});

describe('updateCohortSchema', () => {
  it('requires at least one of name / definition', () => {
    expect(updateCohortSchema.safeParse({}).success).toBe(false);
    expect(updateCohortSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
  });
});
