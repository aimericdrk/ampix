import { useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api/problem';
import type {
  InsightsFilter,
  RetentionInterval,
  RetentionQueryDefinition,
  RetentionResponse,
} from '../../../lib/api/types';
import { RETENTION_INTERVALS } from '../../../lib/api/types';
import { useMetaEvents, useMetaProperties, useRunRetention } from '../api';
import { RetentionChart } from './RetentionChart';
import { PageShell } from '../../../components/layout/PageShell';
import { CohortSelect, SaveAsReportButton } from './report-actions';
import {
  cleanFilters,
  DateRangeFields,
  defaultDate,
  EventNameInput,
  FilterRows,
} from './builder-controls';

const INTERVAL_LABELS: Record<RetentionInterval, string> = {
  day: 'Day',
  week: 'Week',
};

export function RetentionPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/retention' });
  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const runRetention = useRunRetention(projectId);

  const [bornEvent, setBornEvent] = useState('');
  const [bornFilters, setBornFilters] = useState<InsightsFilter[]>([]);
  const [returnEvent, setReturnEvent] = useState('');
  const [returnFilters, setReturnFilters] = useState<InsightsFilter[]>([]);
  const [dateFrom, setDateFrom] = useState(() => defaultDate(30));
  const [dateTo, setDateTo] = useState(() => defaultDate(0));
  const [interval, setInterval] = useState<RetentionInterval>('day');
  const [periods, setPeriods] = useState(14);
  const [cohortId, setCohortId] = useState('');
  const [result, setResult] = useState<RetentionResponse | null>(null);

  const eventOptions = metaEvents.data?.events ?? [];
  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];

  const queryDefinition: RetentionQueryDefinition = useMemo(() => {
    const def: RetentionQueryDefinition = {
      born_event: { name: bornEvent, filters: cleanFilters(bornFilters) },
      date_range: { from: dateFrom, to: dateTo },
      interval,
      periods,
    };
    // return_event is omitted when blank — §15: defaults to born_event server-side.
    if (returnEvent.trim()) {
      def.return_event = { name: returnEvent.trim(), filters: cleanFilters(returnFilters) };
    }
    if (cohortId) def.cohort_id = cohortId;
    return def;
  }, [
    bornEvent,
    bornFilters,
    returnEvent,
    returnFilters,
    dateFrom,
    dateTo,
    interval,
    periods,
    cohortId,
  ]);

  const canRun =
    Boolean(bornEvent.trim()) && Boolean(dateFrom) && Boolean(dateTo) && !runRetention.isPending;

  const handleRun = () => {
    if (!canRun) return;
    runRetention.mutate(queryDefinition, { onSuccess: setResult });
  };

  return (
    <PageShell
      projectId={projectId}
      title="Retention"
      description="Measure how many users come back over time after a first action."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Retention' }]}
    >
      <Card>
        <CardHeader>
          <CardTitle>Retention builder</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <EventNameInput
              id="retention-born-event"
              label="Born event"
              value={bornEvent}
              onChange={setBornEvent}
              options={eventOptions}
              placeholder="e.g. signup_completed"
            />
            <FilterRows
              idPrefix="retention-born-filter"
              ariaLabel="Born event filter"
              filters={bornFilters}
              onChange={setBornFilters}
              propertyNames={propertyNames}
            />
          </div>

          <div className="flex flex-col gap-2">
            <EventNameInput
              id="retention-return-event"
              label="Return event (optional — defaults to born event)"
              value={returnEvent}
              onChange={setReturnEvent}
              options={eventOptions}
              placeholder="e.g. app_open"
            />
            <FilterRows
              idPrefix="retention-return-filter"
              ariaLabel="Return event filter"
              filters={returnFilters}
              onChange={setReturnFilters}
              propertyNames={propertyNames}
            />
          </div>

          <DateRangeFields
            idPrefix="retention-date"
            from={dateFrom}
            to={dateTo}
            onFrom={setDateFrom}
            onTo={setDateTo}
          />

          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="retention-interval" className="mb-1 block text-sm font-medium">
                Interval
              </label>
              <select
                id="retention-interval"
                value={interval}
                onChange={(e) => setInterval(e.target.value as RetentionInterval)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              >
                {RETENTION_INTERVALS.map((value) => (
                  <option key={value} value={value}>
                    {INTERVAL_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="retention-periods" className="mb-1 block text-sm font-medium">
                Periods
              </label>
              <input
                id="retention-periods"
                type="number"
                min={1}
                max={30}
                value={periods}
                onChange={(e) => setPeriods(Number(e.target.value))}
                className="h-10 w-32 rounded-md border border-border bg-surface px-3 text-sm"
              />
            </div>
          </div>

          <CohortSelect projectId={projectId} value={cohortId} onChange={setCohortId} />

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleRun} disabled={!canRun}>
              {runRetention.isPending ? 'Running…' : 'Run'}
            </Button>
            <SaveAsReportButton
              projectId={projectId}
              kind="retention"
              definition={queryDefinition}
              disabled={!bornEvent.trim()}
            />
          </div>
        </CardContent>
      </Card>

      {runRetention.isError && (
        <p role="alert" className="text-danger">
          {runRetention.error instanceof ApiError
            ? runRetention.error.problem.title
            : 'Failed to run retention'}
        </p>
      )}

      {result && result.cohorts.length === 0 && (
        <p className="text-text-muted">No cohorts for this query yet.</p>
      )}

      {result && result.cohorts.length > 0 && (
        <RetentionChart
          cohorts={result.cohorts}
          averages={result.averages}
          interval={interval}
        />
      )}
    </PageShell>
  );
}
