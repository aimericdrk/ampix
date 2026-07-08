import { useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { cn } from '../../../lib/cn';
import type { HistogramQuery } from '../../../lib/api/types';
import { useHistogram, useMetaEvents, useMetaProperties } from '../api';
import { DateRangeControl, useDateRange } from '../date-range';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { ChartCard } from './charts/ChartCard';
import { HistogramChart, formatHistogramValue, type HistogramUnit } from './charts/HistogramChart';
import { KpiTile } from './charts/KpiTile';
import { EventSelectField } from './explore-controls';

/** Maps loading/error/empty query state onto `ChartCard`'s `state` prop (mirrors Revenue/Home). */
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

interface HistogramPreset {
  id: string;
  label: string;
  event: string;
  property: string;
  unit: HistogramUnit;
}

/** feat-09 §3.2 presets: session length (ms → duration) and purchase value (→ currency). */
const PRESETS: HistogramPreset[] = [
  {
    id: 'session-length',
    label: 'Session length',
    event: '$session_end',
    property: '$duration_ms',
    unit: 'duration',
  },
  {
    id: 'purchase-value',
    label: 'Purchase value',
    event: '$in_app_purchase',
    property: '$price',
    unit: 'currency',
  },
];

const CUSTOM_PRESET_ID = 'custom';
const BIN_OPTIONS = [10, 20, 50] as const;

/** A "Metric"/"Bins" segmented radiogroup — same visual pattern as `DateRangePresets`. */
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
 * The Distributions page (feat-09 §3.2) — see the *shape* of a metric, not just its average: a
 * preset picker (Session length / Purchase value / Custom event+property), a bins control, and the
 * `HistogramChart` + a KPI summary strip (total, mean, p50, p90), all time-scoped by the global
 * `useDateRange` + `useGlobalFilters`, mirroring the Revenue page's composition.
 */
export function DistributionsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/distributions' });
  const { from, to } = useDateRange();
  const { filters: globalFilters } = useGlobalFilters();

  const [presetId, setPresetId] = useState<string>(PRESETS[0]!.id);
  const [customEvent, setCustomEvent] = useState('');
  const [customProperty, setCustomProperty] = useState('');
  const [bins, setBins] = useState<number>(20);

  const isCustom = presetId === CUSTOM_PRESET_ID;
  const activePreset = PRESETS.find((preset) => preset.id === presetId);

  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);

  const event = isCustom ? customEvent : (activePreset?.event ?? '');
  const property = isCustom ? customProperty : (activePreset?.property ?? '');
  const unit: HistogramUnit = isCustom ? 'number' : (activePreset?.unit ?? 'number');
  const metricLabel = isCustom ? property || 'Custom metric' : (activePreset?.label ?? '');

  const enabled = event.trim().length > 0 && property.trim().length > 0;

  const query: HistogramQuery = useMemo(
    () => ({
      event,
      property,
      bins,
      date_range: { from, to },
      filters: mergeGlobalFilters([], globalFilters),
    }),
    [event, property, bins, from, to, globalFilters],
  );

  const histogram = useHistogram(projectId, query, enabled);
  const data = histogram.data;
  const isEmpty = !!data && data.total === 0;

  return (
    <PageShell
      projectId={projectId}
      title="Distributions"
      description="See the shape of a metric — session length, purchase value, or any numeric event property — instead of just its average."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Distributions' }]}
      dateRangeControl={<DateRangeControl />}
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          label="Metric"
          value={presetId}
          onChange={setPresetId}
          options={[
            ...PRESETS.map((preset) => ({ id: preset.id, label: preset.label })),
            { id: CUSTOM_PRESET_ID, label: 'Custom…' },
          ]}
        />

        {isCustom && (
          <div className="flex flex-wrap gap-4">
            <EventSelectField
              label="Event"
              value={customEvent}
              onChange={setCustomEvent}
              options={metaEvents.data?.events ?? []}
              isLoading={metaEvents.isPending}
            />
            <EventSelectField
              label="Property"
              value={customProperty}
              onChange={setCustomProperty}
              options={metaProperties.data?.properties.map((property) => property.name) ?? []}
              isLoading={metaProperties.isPending}
              noun="property"
            />
          </div>
        )}

        <SegmentedControl
          label="Bins"
          value={bins}
          onChange={setBins}
          options={BIN_OPTIONS.map((option) => ({ id: option, label: String(option) }))}
        />
      </div>

      {!enabled && (
        <p className="text-sm text-text-muted">
          Choose an event and a numeric property to see its distribution.
        </p>
      )}

      {enabled && histogram.isPending && <p role="status">Loading distribution…</p>}
      {enabled && histogram.isError && (
        <p role="alert" className="text-danger">
          Failed to load distribution
        </p>
      )}

      {enabled && isEmpty && (
        <p className="text-sm text-text-muted">No numeric data for this property.</p>
      )}

      {enabled && data && !isEmpty && (
        <>
          <SectionGrid>
            <KpiTile label="Total" value={data.total} />
            <KpiTile label="Mean" value={formatHistogramValue(data.mean, unit)} />
            <KpiTile label="p50" value={formatHistogramValue(data.p50, unit)} />
            <KpiTile label="p90" value={formatHistogramValue(data.p90, unit)} />
          </SectionGrid>

          <ChartCard
            title={metricLabel}
            description="Distribution of values for the selected range."
            state={chartState(histogram.isPending, histogram.isError, data.buckets.length === 0)}
          >
            <HistogramChart
              buckets={data.buckets}
              ariaLabel={`${metricLabel} distribution`}
              unit={unit}
            />
          </ChartCard>
        </>
      )}
    </PageShell>
  );
}
