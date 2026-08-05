import type { AdvancedAnalyticsService } from '../analytics/services/advanced-analytics.service';
import type { AnalyticsService } from '../analytics/services/analytics.service';
import { AnalysisRunnerService } from './analysis-runner.service';

const USER = 'user-1';
const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';
const insightsDef = {
  events: [{ name: 'checkout_completed', aggregation: 'total' }],
  date_range: { from: '2026-06-01', to: '2026-07-01' },
  interval: 'day',
};

function make() {
  const analytics = { runInsightsQuery: jest.fn().mockResolvedValue({ series: [] }) };
  const advanced = {
    runFunnelQuery: jest.fn().mockResolvedValue({ steps: [] }),
    runRetentionQuery: jest.fn().mockResolvedValue({ cohorts: [] }),
    runFlowQuery: jest.fn().mockResolvedValue({ nodes: [], links: [] }),
  };
  const service = new AnalysisRunnerService(
    analytics as unknown as AnalyticsService,
    advanced as unknown as AdvancedAnalyticsService,
  );
  return { service, analytics, advanced };
}

describe('AnalysisRunnerService (contracts §16)', () => {
  it('dispatches insights to AnalyticsService.runInsightsQuery', async () => {
    const { service, analytics } = make();
    await service.run(USER, PROJECT, 'insights', insightsDef);
    expect(analytics.runInsightsQuery).toHaveBeenCalledWith(USER, PROJECT, insightsDef);
  });

  it.each([
    ['funnel', 'runFunnelQuery'],
    ['retention', 'runRetentionQuery'],
    ['flows', 'runFlowQuery'],
  ] as const)('dispatches %s to the advanced engine', async (kind, method) => {
    const { service, advanced } = make();
    await service.run(USER, PROJECT, kind, { some: 'def' });
    expect(advanced[method]).toHaveBeenCalledWith(USER, PROJECT, { some: 'def' });
  });

  it('merges the date_range + cohort_id override over the stored definition', async () => {
    const { service, analytics } = make();
    const override = { date_range: { from: '2026-01-01', to: '2026-01-31' }, cohort_id: 'c-1' };

    await service.run(USER, PROJECT, 'insights', insightsDef, override);

    expect(analytics.runInsightsQuery).toHaveBeenCalledWith(USER, PROJECT, {
      ...insightsDef,
      date_range: override.date_range,
      cohort_id: 'c-1',
    });
  });

  it('leaves the definition untouched when no override is given', async () => {
    const { service, analytics } = make();
    await service.run(USER, PROJECT, 'insights', insightsDef, {});
    expect(analytics.runInsightsQuery).toHaveBeenCalledWith(USER, PROJECT, { ...insightsDef });
  });
});
