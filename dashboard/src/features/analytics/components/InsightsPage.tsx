import { useParams } from '@tanstack/react-router';
import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { ApiError } from '../../../lib/api/problem';
import type {
  InsightsAggregation,
  InsightsEventQuery,
  InsightsFilter,
  InsightsFilterOp,
  InsightsInterval,
  InsightsQueryDefinition,
  InsightsResponse,
} from '../../../lib/api/types';
import { INSIGHTS_FILTER_OPS, INSIGHTS_INTERVALS } from '../../../lib/api/types';
import { useMetaEvents, useMetaProperties, useRunInsights } from '../api';
import { InsightsChart } from './InsightsChart';
import { ProjectAnalyticsNav } from './ProjectAnalyticsNav';
import { CohortSelect, SaveAsReportButton } from './report-actions';

const MAX_EVENTS = 5;

const FILTER_OP_LABELS: Record<InsightsFilterOp, string> = {
  eq: 'equals',
  neq: 'does not equal',
  contains: 'contains',
  gt: 'greater than',
  lt: 'less than',
  is_set: 'is set',
  is_not_set: 'is not set',
};

const VALUELESS_OPS = new Set<InsightsFilterOp>(['is_set', 'is_not_set']);

function defaultDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function InsightsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/insights' });
  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const runInsights = useRunInsights(projectId);

  const [events, setEvents] = useState<InsightsEventQuery[]>([]);
  const [eventDraft, setEventDraft] = useState('');
  const [dateFrom, setDateFrom] = useState(() => defaultDate(30));
  const [dateTo, setDateTo] = useState(() => defaultDate(0));
  const [interval, setInterval] = useState<InsightsInterval>('day');
  const [filters, setFilters] = useState<InsightsFilter[]>([]);
  const [breakdownProperty, setBreakdownProperty] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [result, setResult] = useState<InsightsResponse | null>(null);

  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];

  const handleAddEvent = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    const name = eventDraft.trim();
    if (!name || events.length >= MAX_EVENTS || events.some((e) => e.name === name)) return;
    setEvents((current) => [...current, { name, aggregation: 'total' }]);
    setEventDraft('');
  };

  const updateAggregation = (name: string, aggregation: InsightsAggregation) => {
    setEvents((current) => current.map((e) => (e.name === name ? { ...e, aggregation } : e)));
  };

  const removeEvent = (name: string) => {
    setEvents((current) => current.filter((e) => e.name !== name));
  };

  const addFilter = () => {
    setFilters((current) => [
      ...current,
      { property: propertyNames[0] ?? '', op: 'eq', value: '' },
    ]);
  };

  const updateFilter = (index: number, patch: Partial<InsightsFilter>) => {
    setFilters((current) => current.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const removeFilter = (index: number) => {
    setFilters((current) => current.filter((_, i) => i !== index));
  };

  const queryDefinition: InsightsQueryDefinition = useMemo(() => {
    const cleanFilters = filters.filter(
      (f) => f.property && (VALUELESS_OPS.has(f.op) || (f.value ?? '').trim() !== ''),
    );
    const def: InsightsQueryDefinition = {
      events,
      date_range: { from: dateFrom, to: dateTo },
      interval,
      filters: cleanFilters.map((f) =>
        VALUELESS_OPS.has(f.op) ? { property: f.property, op: f.op } : f,
      ),
    };
    if (breakdownProperty) def.breakdown = { property: breakdownProperty };
    if (cohortId) def.cohort_id = cohortId;
    return def;
  }, [events, dateFrom, dateTo, interval, filters, breakdownProperty, cohortId]);

  const canRun =
    events.length > 0 && Boolean(dateFrom) && Boolean(dateTo) && !runInsights.isPending;

  const handleRun = () => {
    if (!canRun) return;
    runInsights.mutate(queryDefinition, { onSuccess: setResult });
  };

  return (
    <section className="flex flex-col gap-6">
      <ProjectAnalyticsNav projectId={projectId} />
      <h1 className="text-2xl font-semibold">Insights</h1>

      <Card>
        <CardHeader>
          <CardTitle>Query builder</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div>
            <span className="mb-1 block text-sm font-medium">Events</span>
            <form onSubmit={handleAddEvent} className="flex items-end gap-2">
              <div className="flex-1">
                <label htmlFor="event-draft" className="sr-only">
                  Add an event
                </label>
                <Input
                  id="event-draft"
                  list="meta-events-options"
                  placeholder="e.g. checkout_completed"
                  value={eventDraft}
                  onChange={(e) => setEventDraft(e.target.value)}
                  disabled={events.length >= MAX_EVENTS}
                />
                <datalist id="meta-events-options">
                  {(metaEvents.data?.events ?? []).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={!eventDraft.trim() || events.length >= MAX_EVENTS}
              >
                Add event
              </Button>
            </form>
            {events.length >= MAX_EVENTS && (
              <p className="mt-1 text-xs text-text-muted">Up to {MAX_EVENTS} events per query.</p>
            )}

            {events.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {events.map((ev) => (
                  <li
                    key={ev.name}
                    className="flex items-center gap-2 rounded-md border border-border p-2"
                  >
                    <span className="flex-1 text-sm font-medium">{ev.name}</span>
                    <label className="sr-only" htmlFor={`aggregation-${ev.name}`}>
                      Aggregation for {ev.name}
                    </label>
                    <select
                      id={`aggregation-${ev.name}`}
                      value={ev.aggregation}
                      onChange={(e) =>
                        updateAggregation(ev.name, e.target.value as InsightsAggregation)
                      }
                      className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
                    >
                      <option value="total">Total count</option>
                      <option value="unique_users">Unique users</option>
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${ev.name}`}
                      onClick={() => removeEvent(ev.name)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="date-from" className="mb-1 block text-sm font-medium">
                From
              </label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="date-to" className="mb-1 block text-sm font-medium">
                To
              </label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="interval" className="mb-1 block text-sm font-medium">
                Interval
              </label>
              <select
                id="interval"
                value={interval}
                onChange={(e) => setInterval(e.target.value as InsightsInterval)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              >
                {INSIGHTS_INTERVALS.map((value) => (
                  <option key={value} value={value}>
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Filters (all must match)</span>
              <Button type="button" variant="secondary" size="sm" onClick={addFilter}>
                Add filter
              </Button>
            </div>
            {filters.length === 0 && (
              <p className="text-sm text-text-muted">No filters — matches everything.</p>
            )}
            <ul className="flex flex-col gap-2">
              {filters.map((filter, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`filter-property-${index}`}>
                    Filter property
                  </label>
                  <select
                    id={`filter-property-${index}`}
                    value={filter.property}
                    onChange={(e) => updateFilter(index, { property: e.target.value })}
                    className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    {propertyNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor={`filter-op-${index}`}>
                    Filter operator
                  </label>
                  <select
                    id={`filter-op-${index}`}
                    value={filter.op}
                    onChange={(e) =>
                      updateFilter(index, { op: e.target.value as InsightsFilterOp })
                    }
                    className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    {INSIGHTS_FILTER_OPS.map((op) => (
                      <option key={op} value={op}>
                        {FILTER_OP_LABELS[op]}
                      </option>
                    ))}
                  </select>
                  {!VALUELESS_OPS.has(filter.op) && (
                    <>
                      <label className="sr-only" htmlFor={`filter-value-${index}`}>
                        Filter value
                      </label>
                      <Input
                        id={`filter-value-${index}`}
                        className="h-9 w-40"
                        value={filter.value ?? ''}
                        onChange={(e) => updateFilter(index, { value: e.target.value })}
                      />
                    </>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove filter ${index + 1}`}
                    onClick={() => removeFilter(index)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label htmlFor="breakdown" className="mb-1 block text-sm font-medium">
              Breakdown (optional)
            </label>
            <select
              id="breakdown"
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

          <CohortSelect projectId={projectId} value={cohortId} onChange={setCohortId} />

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleRun} disabled={!canRun}>
              {runInsights.isPending ? 'Running…' : 'Run'}
            </Button>
            <SaveAsReportButton
              projectId={projectId}
              kind="insights"
              definition={queryDefinition}
              disabled={events.length === 0}
            />
          </div>
        </CardContent>
      </Card>

      {runInsights.isError && (
        <p role="alert" className="text-danger">
          {runInsights.error instanceof ApiError
            ? runInsights.error.problem.title
            : 'Failed to run the query'}
        </p>
      )}

      {result && result.series.length === 0 && (
        <p className="text-text-muted">No data for this query yet.</p>
      )}

      {result && result.series.length > 0 && (
        <InsightsChart series={result.series} eventOrder={events.map((e) => e.name)} />
      )}
    </section>
  );
}
