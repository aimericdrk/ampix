import { useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api/problem';
import type {
  FlowsDirection,
  FlowsQueryDefinition,
  FlowsResponse,
  FlowsUnit,
  InsightsFilter,
} from '../../../lib/api/types';
import { FLOWS_DIRECTIONS, FLOWS_UNITS } from '../../../lib/api/types';
import { useMetaEvents, useMetaProperties, useRunFlows } from '../api';
import { FlowsChart } from './FlowsChart';
import { ProjectAnalyticsNav } from './ProjectAnalyticsNav';
import {
  cleanFilters,
  DateRangeFields,
  defaultDate,
  EventNameInput,
  FilterRows,
} from './builder-controls';

const DIRECTION_LABELS: Record<FlowsDirection, string> = {
  forward: 'Forward (events after anchor)',
  backward: 'Backward (events before anchor)',
};

const UNIT_LABELS: Record<FlowsUnit, string> = {
  session: 'Per session',
  user: 'Per user',
};

export function FlowsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/flows' });
  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const runFlows = useRunFlows(projectId);

  const [anchorEvent, setAnchorEvent] = useState('');
  const [anchorFilters, setAnchorFilters] = useState<InsightsFilter[]>([]);
  const [direction, setDirection] = useState<FlowsDirection>('forward');
  const [dateFrom, setDateFrom] = useState(() => defaultDate(30));
  const [dateTo, setDateTo] = useState(() => defaultDate(0));
  const [steps, setSteps] = useState(3);
  const [maxNodesPerStep, setMaxNodesPerStep] = useState(8);
  const [unit, setUnit] = useState<FlowsUnit>('session');
  const [result, setResult] = useState<FlowsResponse | null>(null);

  const eventOptions = metaEvents.data?.events ?? [];
  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];

  const queryDefinition: FlowsQueryDefinition = useMemo(
    () => ({
      anchor: { event: anchorEvent, filters: cleanFilters(anchorFilters) },
      direction,
      date_range: { from: dateFrom, to: dateTo },
      steps,
      max_nodes_per_step: maxNodesPerStep,
      unit,
    }),
    [anchorEvent, anchorFilters, direction, dateFrom, dateTo, steps, maxNodesPerStep, unit],
  );

  const canRun =
    Boolean(anchorEvent.trim()) && Boolean(dateFrom) && Boolean(dateTo) && !runFlows.isPending;

  const handleRun = () => {
    if (!canRun) return;
    runFlows.mutate(queryDefinition, { onSuccess: setResult });
  };

  return (
    <section className="flex flex-col gap-6">
      <ProjectAnalyticsNav projectId={projectId} />
      <h1 className="text-2xl font-semibold">Flows</h1>

      <Card>
        <CardHeader>
          <CardTitle>Flow builder</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <EventNameInput
              id="flows-anchor-event"
              label="Anchor event"
              value={anchorEvent}
              onChange={setAnchorEvent}
              options={eventOptions}
              placeholder="e.g. app_open"
            />
            <FilterRows
              idPrefix="flows-anchor-filter"
              ariaLabel="Anchor filter"
              filters={anchorFilters}
              onChange={setAnchorFilters}
              propertyNames={propertyNames}
            />
          </div>

          <DateRangeFields
            idPrefix="flows-date"
            from={dateFrom}
            to={dateTo}
            onFrom={setDateFrom}
            onTo={setDateTo}
          />

          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="flows-direction" className="mb-1 block text-sm font-medium">
                Direction
              </label>
              <select
                id="flows-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as FlowsDirection)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              >
                {FLOWS_DIRECTIONS.map((value) => (
                  <option key={value} value={value}>
                    {DIRECTION_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="flows-unit" className="mb-1 block text-sm font-medium">
                Unit
              </label>
              <select
                id="flows-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as FlowsUnit)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              >
                {FLOWS_UNITS.map((value) => (
                  <option key={value} value={value}>
                    {UNIT_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="flows-steps" className="mb-1 block text-sm font-medium">
                Steps (hops)
              </label>
              <input
                id="flows-steps"
                type="number"
                min={1}
                max={5}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                className="h-10 w-32 rounded-md border border-border bg-surface px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="flows-max-nodes" className="mb-1 block text-sm font-medium">
                Max nodes per step
              </label>
              <input
                id="flows-max-nodes"
                type="number"
                min={1}
                max={20}
                value={maxNodesPerStep}
                onChange={(e) => setMaxNodesPerStep(Number(e.target.value))}
                className="h-10 w-32 rounded-md border border-border bg-surface px-3 text-sm"
              />
            </div>
          </div>

          <div>
            <Button onClick={handleRun} disabled={!canRun}>
              {runFlows.isPending ? 'Running…' : 'Run'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {runFlows.isError && (
        <p role="alert" className="text-danger">
          {runFlows.error instanceof ApiError
            ? runFlows.error.problem.title
            : 'Failed to run the flow'}
        </p>
      )}

      {result && result.nodes.length === 0 && (
        <p className="text-text-muted">No flow data for this query yet.</p>
      )}

      {result && result.nodes.length > 0 && (
        <FlowsChart nodes={result.nodes} links={result.links} />
      )}
    </section>
  );
}
