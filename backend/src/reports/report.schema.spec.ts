import { ProblemException } from '../common/problem-details';
import {
  createReportSchema,
  updateReportSchema,
  validateReportDefinition,
} from './report.schema';

const insightsDef = {
  events: [{ name: 'checkout_completed', aggregation: 'total' }],
  date_range: { from: '2026-06-01', to: '2026-07-01' },
  interval: 'day',
};
const funnelDef = {
  steps: [{ event: 'app_open' }, { event: 'checkout_completed' }],
  date_range: { from: '2026-06-01', to: '2026-07-01' },
  window_days: 7,
};

describe('validateReportDefinition (contracts §16 — definition validated by kind)', () => {
  it('accepts an insights definition for kind=insights', () => {
    expect(() => validateReportDefinition('insights', insightsDef)).not.toThrow();
  });

  it('accepts a funnel definition for kind=funnel', () => {
    expect(() => validateReportDefinition('funnel', funnelDef)).not.toThrow();
  });

  it('rejects a funnel definition under kind=insights with a 400', () => {
    try {
      validateReportDefinition('insights', funnelDef);
      throw new Error('expected a 400');
    } catch (err) {
      expect(err).toBeInstanceOf(ProblemException);
      expect((err as ProblemException).problem.status).toBe(400);
    }
  });

  it('rejects an insights definition under kind=funnel with a 400', () => {
    expect(() => validateReportDefinition('funnel', insightsDef)).toThrow(ProblemException);
  });

  it('rejects a definition with an unknown interval (still runs the §14 schema)', () => {
    expect(() =>
      validateReportDefinition('insights', { ...insightsDef, interval: 'decade' }),
    ).toThrow(ProblemException);
  });
});

describe('createReportSchema', () => {
  it('requires name + a known kind (definition validated separately by kind)', () => {
    expect(
      createReportSchema.safeParse({ name: 'Weekly checkout', kind: 'insights', definition: insightsDef })
        .success,
    ).toBe(true);
    expect(
      createReportSchema.safeParse({ name: 'x', kind: 'nope', definition: insightsDef }).success,
    ).toBe(false);
    expect(createReportSchema.safeParse({ name: '', kind: 'insights', definition: {} }).success).toBe(
      false,
    );
  });
});

describe('updateReportSchema', () => {
  it('requires at least one of name / definition', () => {
    expect(updateReportSchema.safeParse({}).success).toBe(false);
    expect(updateReportSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
    expect(updateReportSchema.safeParse({ definition: insightsDef }).success).toBe(true);
  });
});
