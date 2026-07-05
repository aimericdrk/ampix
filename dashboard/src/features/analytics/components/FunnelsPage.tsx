import { useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api/problem';
import type {
  FunnelOrder,
  FunnelQueryDefinition,
  FunnelResponse,
  FunnelStep,
  InsightsFilter,
} from '../../../lib/api/types';
import { FUNNEL_ORDERS } from '../../../lib/api/types';
import { useMetaEvents, useMetaProperties, useRunFunnels } from '../api';
import { FunnelChart } from './FunnelChart';
import { PageShell } from '../../../components/layout/PageShell';
import { CohortSelect, SaveAsReportButton } from './report-actions';
import { cleanFilters, defaultDate, FilterRows } from './builder-controls';
import { DateRangePresets, EventPicker } from './explore-controls';

const MAX_STEPS = 8;

interface StepDraft {
  event: string;
  filters: InsightsFilter[];
}

const ORDER_LABELS: Record<FunnelOrder, string> = {
  any: 'Any order',
  strict_order: 'Strict order',
};

export function FunnelsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/funnels' });
  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const runFunnels = useRunFunnels(projectId);

  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [dateFrom, setDateFrom] = useState(() => defaultDate(30));
  const [dateTo, setDateTo] = useState(() => defaultDate(0));
  const [windowDays, setWindowDays] = useState(7);
  const [order, setOrder] = useState<FunnelOrder>('any');
  const [breakdownProperty, setBreakdownProperty] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [result, setResult] = useState<FunnelResponse | null>(null);

  const eventOptions = metaEvents.data?.events ?? [];
  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];

  const addStep = (name: string) => {
    if (!name || steps.length >= MAX_STEPS) return;
    setSteps((current) => [...current, { event: name, filters: [] }]);
  };

  const removeStep = (index: number) => {
    setSteps((current) => current.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, delta: number) => {
    setSteps((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const moved = next[index];
      const displaced = next[target];
      if (!moved || !displaced) return current;
      next[index] = displaced;
      next[target] = moved;
      return next;
    });
  };

  const setStepFilters = (index: number, filters: InsightsFilter[]) => {
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, filters } : s)));
  };

  const queryDefinition: FunnelQueryDefinition = useMemo(() => {
    const cleanedSteps: FunnelStep[] = steps.map((s) => ({
      event: s.event,
      filters: cleanFilters(s.filters),
    }));
    const def: FunnelQueryDefinition = {
      steps: cleanedSteps,
      date_range: { from: dateFrom, to: dateTo },
      window_days: windowDays,
      order,
    };
    if (breakdownProperty) def.breakdown = { property: breakdownProperty };
    if (cohortId) def.cohort_id = cohortId;
    return def;
  }, [steps, dateFrom, dateTo, windowDays, order, breakdownProperty, cohortId]);

  const canRun =
    steps.length >= 2 && Boolean(dateFrom) && Boolean(dateTo) && !runFunnels.isPending;

  const handleRun = () => {
    if (!canRun) return;
    runFunnels.mutate(queryDefinition, { onSuccess: setResult });
  };

  return (
    <PageShell
      projectId={projectId}
      title="Funnels"
      description="See how users move through an ordered sequence of steps, and where they drop off."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Funnels' }]}
    >
      <Card>
        <CardHeader>
          <CardTitle>Funnel builder</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div>
            <span className="mb-1 block text-sm font-medium">Steps (2–{MAX_STEPS}, in order)</span>

            {steps.length > 0 && (
              <ul className="mt-3 flex flex-col gap-3">
                {steps.map((step, index) => (
                  <li
                    key={`${step.event}-${index}`}
                    className="flex flex-col gap-2 rounded-md border border-border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-sm font-medium">
                        {index + 1}. {step.event}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Move step ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                      >
                        Up
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Move step ${index + 1} down`}
                        disabled={index === steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        Down
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove step ${index + 1}`}
                        onClick={() => removeStep(index)}
                      >
                        Remove
                      </Button>
                    </div>
                    <FilterRows
                      idPrefix={`funnel-step-${index}-filter`}
                      ariaLabel={`Step ${index + 1} filter`}
                      filters={step.filters}
                      onChange={(filters) => setStepFilters(index, filters)}
                      propertyNames={propertyNames}
                    />
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3">
              <EventPicker
                options={eventOptions}
                onSelect={addStep}
                isLoading={metaEvents.isPending}
                disabled={steps.length >= MAX_STEPS}
                comboLabel="Add step"
                triggerLabel="Add step"
              />
            </div>
            {steps.length < 2 && (
              <p className="mt-2 text-xs text-text-muted">Add at least two steps to run a funnel.</p>
            )}
          </div>

          <DateRangePresets
            idPrefix="funnel-date"
            from={dateFrom}
            to={dateTo}
            onChange={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
            }}
          />

          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="funnel-window" className="mb-1 block text-sm font-medium">
                Conversion window (days)
              </label>
              <input
                id="funnel-window"
                type="number"
                min={1}
                max={365}
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
                className="h-10 w-32 rounded-md border border-border bg-surface px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="funnel-order" className="mb-1 block text-sm font-medium">
                Step order
              </label>
              <select
                id="funnel-order"
                value={order}
                onChange={(e) => setOrder(e.target.value as FunnelOrder)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              >
                {FUNNEL_ORDERS.map((value) => (
                  <option key={value} value={value}>
                    {ORDER_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="funnel-breakdown" className="mb-1 block text-sm font-medium">
                Breakdown (optional)
              </label>
              <select
                id="funnel-breakdown"
                value={breakdownProperty}
                onChange={(e) => setBreakdownProperty(e.target.value)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              >
                <option value="">No breakdown</option>
                {propertyNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <CohortSelect projectId={projectId} value={cohortId} onChange={setCohortId} />

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleRun} disabled={!canRun}>
              {runFunnels.isPending ? 'Running…' : 'Run'}
            </Button>
            <SaveAsReportButton
              projectId={projectId}
              kind="funnel"
              definition={queryDefinition}
              disabled={steps.length < 2}
            />
          </div>
        </CardContent>
      </Card>

      {runFunnels.isError && (
        <p role="alert" className="text-danger">
          {runFunnels.error instanceof ApiError
            ? runFunnels.error.problem.title
            : 'Failed to run the funnel'}
        </p>
      )}

      {result && result.steps.length === 0 && (
        <p className="text-text-muted">No data for this funnel yet.</p>
      )}

      {result && result.steps.length > 0 && (
        <FunnelChart
          steps={result.steps}
          overallConversion={result.overall_conversion}
          breakdowns={result.breakdowns}
        />
      )}
    </PageShell>
  );
}
