import { useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { cn } from '../../../lib/cn';
import type { InsightsQueryDefinition, InsightsSeries } from '../../../lib/api/types';
import { useInsightsQuery, useMetaEvents, useMetaProperties, useMetaPropertyValues } from '../api';
import { breakdownBars } from '../derive';
import { formatPercent } from '../format';
import { DateRangeControl, useDateRange } from '../date-range';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { colorForIndex } from '../palette';
import { BreakdownChart, type BreakdownDatum } from './charts/BreakdownChart';
import { ChartCard } from './charts/ChartCard';
import { DonutChart } from './charts/DonutChart';
import { KpiTile } from './charts/KpiTile';
import { InsightsChart } from './InsightsChart';
import { EventSelectField } from './explore-controls';

/** Maps loading/error/empty query state onto `ChartCard`'s `state` prop (mirrors Revenue/Distributions). */
function chartState(
  isPending: boolean,
  isError: boolean,
  isEmpty: boolean,
): 'loading' | 'error' | 'empty' | 'ready' {
  if (isPending) return 'loading';
  if (isError) return 'error';
  if (isEmpty) return 'empty';
  return 'ready';
}

const TOP_N_OPTIONS = [5, 10, 20] as const;
const OTHER_LABEL = 'Other';

/** A "Top" segmented radiogroup — same visual pattern as `DateRangePresets`/Distributions' Bins control. */
function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex w-fit flex-wrap gap-0.5 rounded-lg border border-border bg-surface p-0.5"
      >
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                active
                  ? 'bg-accent font-medium text-accent-fg'
                  : 'text-text-muted hover:bg-border/40 hover:text-text',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Top-N + "Other" rollup: `bars` is already sorted desc (per `breakdownBars`); anything past
 * `topN` folds into a single `Other` bucket (omitted entirely when there's no overflow), per
 * feat-03 §4's existing top-N-plus-rollup convention.
 */
function foldTopN(bars: BreakdownDatum[], topN: number): BreakdownDatum[] {
  if (bars.length <= topN) return bars;
  const top = bars.slice(0, topN);
  const restTotal = bars.slice(topN).reduce((sum, bar) => sum + bar.value, 0);
  return restTotal > 0 ? [...top, { label: OTHER_LABEL, value: restTotal }] : top;
}

interface ValueRow {
  value: string;
  count: number;
  share: number;
}

const VALUE_COLUMNS: Array<DataTableColumn<ValueRow>> = [
  { key: 'value', header: 'Value', sortable: true },
  { key: 'count', header: 'Count', sortable: true, align: 'right' },
  {
    key: 'share',
    header: 'Share',
    sortable: true,
    align: 'right',
    render: (row) => formatPercent(row.share),
  },
];

/**
 * The Property Value Explorer (feat-10) — pick any property (OS, plan, country, a custom
 * property) and instantly see its top values with counts and share, how each value trends over
 * time, and a full value table, without hand-building an Insights breakdown query. Pure
 * composition of the existing insights-breakdown engine + v4 chart primitives (the same ones
 * Home's OS/app-version breakdowns use, feat-03), generalized to any property and reusing that
 * feature's `onSelectValue` -> global-filter drill-down.
 */
export function PropertyExplorerPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/properties' });
  const { from, to } = useDateRange();
  const { filters: globalFilters, toggleGlobalFilter } = useGlobalFilters();

  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);

  const [property, setProperty] = useState('');
  // '' = "All events" (see `usingAllEventsFallback` below).
  const [eventScope, setEventScope] = useState('');
  const [topN, setTopN] = useState<number>(10);

  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];
  const eventOptions = metaEvents.data?.events ?? [];

  // The insights breakdown engine has no "all events" wildcard (the same constraint Home's own
  // OS/app-version breakdowns hit) — "All events" (the default, blank scope) falls back to the
  // project's first real event so the query stays well-formed; the note below makes that explicit.
  const usingAllEventsFallback = eventScope.trim().length === 0;
  const effectiveEvent = usingAllEventsFallback ? (eventOptions[0] ?? '') : eventScope;

  const propertyValues = useMetaPropertyValues(projectId, property);

  const enabled =
    property.trim().length > 0 &&
    effectiveEvent.trim().length > 0 &&
    from.length > 0 &&
    to.length > 0;

  const definition: InsightsQueryDefinition = useMemo(
    () => ({
      events: [{ name: effectiveEvent, aggregation: 'total' }],
      date_range: { from, to },
      interval: 'day',
      filters: mergeGlobalFilters([], globalFilters),
      breakdown: { property },
    }),
    [effectiveEvent, from, to, globalFilters, property],
  );

  const result = useInsightsQuery(projectId, definition, enabled);

  const bars = result.data ? breakdownBars(result.data) : [];
  const folded = foldTopN(bars, topN);
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);
  const topBar = bars[0];
  const topShare = topBar && total > 0 ? topBar.value / total : 0;
  const distinctValues = propertyValues.data?.values.length ?? bars.length;

  const activePropertyFilter = globalFilters.find(
    (f) => f.property === property && f.op === 'eq',
  )?.value;

  const sliceColor = new Map(folded.map((bar, index) => [bar.label, colorForIndex(index)]));

  const topLabels = new Set(
    folded.filter((bar) => bar.label !== OTHER_LABEL).map((bar) => bar.label),
  );
  const trendSeries: InsightsSeries[] = (result.data?.series ?? []).filter((series) =>
    topLabels.has(series.breakdown_value ?? '(none)'),
  );

  const rows: ValueRow[] = bars.map((bar) => ({
    value: bar.label,
    count: bar.value,
    share: total > 0 ? bar.value / total : 0,
  }));

  const isEmpty = !!result.data && bars.length === 0;
  const state = chartState(result.isPending, result.isError, isEmpty);

  return (
    <PageShell
      projectId={projectId}
      title="Properties"
      description="Pick any property to see its top values, how each trends over time, and its share of the whole."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Properties' }]}
      dateRangeControl={<DateRangeControl />}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4">
          <EventSelectField
            label="Property"
            value={property}
            onChange={setProperty}
            options={propertyNames}
            isLoading={metaProperties.isPending}
            noun="property"
          />
          <EventSelectField
            label="Event scope"
            value={eventScope}
            onChange={setEventScope}
            options={eventOptions}
            isLoading={metaEvents.isPending}
            noun="event"
            placeholder="All events"
            allowClear
          />
        </div>

        {usingAllEventsFallback && effectiveEvent && (
          <p className="text-xs text-text-muted">
            Scoped to <code>{effectiveEvent}</code> — the query engine counts a specific event,
            not a true "all events" total. Pick an event above to scope precisely.
          </p>
        )}

        <SegmentedControl
          label="Top"
          value={topN}
          onChange={setTopN}
          options={TOP_N_OPTIONS.map((option) => ({ id: option, label: String(option) }))}
        />
      </div>

      {!property && (
        <p className="text-sm text-text-muted">Choose a property to see its top values.</p>
      )}

      {property && !enabled && (
        <p className="text-sm text-text-muted">
          No events tracked yet — property values need at least one event to count against.
        </p>
      )}

      {property && enabled && result.isPending && <p role="status">Loading property values…</p>}
      {property && enabled && result.isError && (
        <p role="alert" className="text-danger">
          Failed to load property values
        </p>
      )}

      {property && enabled && isEmpty && (
        <p className="text-sm text-text-muted">No values for {property} in this range.</p>
      )}

      {property && enabled && result.data && !isEmpty && (
        <>
          <SectionGrid>
            <KpiTile label="Distinct values" value={distinctValues} />
            <KpiTile label="Total" value={total} />
            <KpiTile
              label="Top value"
              value={topBar?.label ?? '—'}
              hint={topBar ? `${formatPercent(topShare)} of total` : undefined}
            />
          </SectionGrid>

          <ChartCard
            title="Top values"
            description={`Top ${Math.min(topN, bars.length)} of ${bars.length} value${bars.length === 1 ? '' : 's'}.`}
            state={state}
          >
            <BreakdownChart
              data={folded}
              ariaLabel={`Top values for ${property}`}
              onSelectValue={(value) => toggleGlobalFilter({ property, op: 'eq', value })}
              selectedValue={activePropertyFilter}
            />
          </ChartCard>

          <ChartCard title="Share of total" state={state}>
            <DonutChart
              slices={folded.map((bar) => ({ key: bar.label, label: bar.label, value: bar.value }))}
              colorFor={(key) => sliceColor.get(key) ?? 'var(--series-1)'}
              ariaLabel={`Share of total for ${property}`}
              centerLabel="Total"
              centerValue={total}
              onSelectValue={(value) => toggleGlobalFilter({ property, op: 'eq', value })}
              selectedValue={activePropertyFilter}
            />
          </ChartCard>

          <ChartCard
            title="Trend"
            state={chartState(result.isPending, result.isError, trendSeries.length === 0)}
          >
            <InsightsChart series={trendSeries} eventOrder={[effectiveEvent]} />
          </ChartCard>

          <ChartCard title="Values">
            <DataTable
              columns={VALUE_COLUMNS}
              rows={rows}
              caption={`Values for ${property}`}
              initialSort={{ key: 'count', dir: 'desc' }}
              rowKey={(row) => row.value}
              exportFilename={`property-${property}`}
            />
          </ChartCard>
        </>
      )}
    </PageShell>
  );
}
