import { useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { FlaskConical, Play } from 'lucide-react';
import { PageShell } from '../../../components/layout/PageShell';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { Input } from '../../../components/ui/input';
import { Reveal } from '../../../components/ui/reveal';
import { Segmented } from '../../../components/ui/segmented';
import { ApiError } from '../../../lib/api/problem';
import type { ExperimentQueryDefinition, VariantTarget } from '../../../lib/api/types';
import { useMetaEvents, useMetaProperties, useRunExperiment } from '../api';
import { DateRangeControl, useDateRange } from '../date-range';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { EventSelectField } from './explore-controls';
import { ExperimentResults } from './ExperimentResults';
import { SaveAsReportButton } from './report-actions';

/** Conversion windows offered as presets — the span most mobile tests are decided over. */
const WINDOW_OPTIONS = [1, 3, 7, 14, 30] as const;

const VARIANT_TARGETS: Array<{ value: VariantTarget; label: string }> = [
  { value: 'event', label: 'On the event' },
  { value: 'profile', label: 'On the user profile' },
];

/**
 * Experiments — the A/B test readout.
 *
 * An experiment is three things this page asks you to name, because no analytics backend can guess
 * them: which property carries the variant label, which event means "this user entered the test",
 * and which event counts as a conversion. From those it reports each arm's conversion rate, the
 * uplift against the control, and — the part a cohort or a funnel breakdown genuinely cannot give
 * you — whether the difference between them is a result or noise.
 *
 * The variant property is picked from the project's own `/meta/properties`, not hardcoded: apps
 * assign variants however they already do, and demanding a magic property name would mean the page
 * only worked for tests started after it shipped.
 */
export function ExperimentsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/experiments' });
  const { from, to } = useDateRange();
  const { filters: globalFilters } = useGlobalFilters();

  const [variantProperty, setVariantProperty] = useState('');
  const [variantTarget, setVariantTarget] = useState<VariantTarget>('event');
  const [exposureEvent, setExposureEvent] = useState('');
  const [goalEvent, setGoalEvent] = useState('');
  const [conversionWindowDays, setConversionWindowDays] = useState<number>(7);
  const [controlVariant, setControlVariant] = useState('');

  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const runExperiment = useRunExperiment(projectId);

  const ready =
    variantProperty.trim().length > 0 &&
    exposureEvent.trim().length > 0 &&
    goalEvent.trim().length > 0;

  const definition: ExperimentQueryDefinition = useMemo(
    () => ({
      variant_property: variantProperty,
      variant_target: variantTarget,
      exposure_event: exposureEvent,
      // The page-level filters apply to who ENTERS the test, not to what counts as a conversion:
      // narrowing the goal by the same filters would drop conversions from users already counted
      // as exposed and understate every arm.
      exposure_filters: mergeGlobalFilters([], globalFilters),
      goal_event: goalEvent,
      goal_filters: [],
      date_range: { from, to },
      conversion_window_days: conversionWindowDays,
      ...(controlVariant.trim() ? { control_variant: controlVariant.trim() } : {}),
    }),
    [
      variantProperty,
      variantTarget,
      exposureEvent,
      goalEvent,
      conversionWindowDays,
      controlVariant,
      from,
      to,
      globalFilters,
    ],
  );

  const result = runExperiment.data;

  return (
    <PageShell
      projectId={projectId}
      title="Experiments"
      description="Compare your A/B test's variants — conversion rate, uplift, and whether the difference is real or just noise."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Experiments' }]}
      dateRangeControl={<DateRangeControl />}
      actions={
        result ? (
          <SaveAsReportButton projectId={projectId} kind="experiment" definition={definition} />
        ) : undefined
      }
    >
      <Reveal index={0}>
        <Card>
          <CardHeader>
            <CardTitle>Test setup</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <EventSelectField
                label="Variant property"
                value={variantProperty}
                onChange={setVariantProperty}
                options={metaProperties.data?.properties.map((property) => property.name) ?? []}
                isLoading={metaProperties.isPending}
                noun="property"
                placeholder="Select the property holding the variant…"
              />
              <div>
                <span className="mb-1 block text-sm font-medium">Variant is recorded</span>
                <Segmented
                  aria-label="Where the variant is recorded"
                  value={variantTarget}
                  onValueChange={(value) => setVariantTarget(value as VariantTarget)}
                  options={VARIANT_TARGETS}
                  className="w-fit"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <EventSelectField
                label="Exposure event"
                value={exposureEvent}
                onChange={setExposureEvent}
                options={metaEvents.data?.events ?? []}
                isLoading={metaEvents.isPending}
                placeholder="When did a user enter the test?"
              />
              <EventSelectField
                label="Goal event"
                value={goalEvent}
                onChange={setGoalEvent}
                options={metaEvents.data?.events ?? []}
                isLoading={metaEvents.isPending}
                placeholder="What counts as a conversion?"
              />
            </div>

            <div className="flex flex-wrap items-end gap-6">
              <div>
                <span className="mb-1 block text-sm font-medium">Conversion window</span>
                <Segmented
                  aria-label="Conversion window in days"
                  value={String(conversionWindowDays)}
                  onValueChange={(value) => setConversionWindowDays(Number(value))}
                  options={WINDOW_OPTIONS.map((days) => ({
                    value: String(days),
                    label: days === 1 ? '1 day' : `${days} days`,
                  }))}
                  className="w-fit flex-wrap"
                />
                <p className="mt-1 text-xs text-text-muted">
                  How long after seeing the test a conversion still counts.
                </p>
              </div>

              <div>
                <label htmlFor="control-variant" className="mb-1 block text-sm font-medium">
                  Control variant <span className="text-text-muted">(optional)</span>
                </label>
                <Input
                  id="control-variant"
                  value={controlVariant}
                  onChange={(event) => setControlVariant(event.target.value)}
                  placeholder="Largest variant"
                  autoComplete="off"
                  className="w-56"
                />
                <p className="mt-1 text-xs text-text-muted">
                  The baseline every other variant is compared against.
                </p>
              </div>
            </div>

            <div>
              <Button
                type="button"
                className="gap-2"
                disabled={!ready || runExperiment.isPending}
                onClick={() => runExperiment.mutate(definition)}
              >
                <Play className="size-4" aria-hidden />
                {runExperiment.isPending ? 'Running…' : 'Run experiment'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </Reveal>

      {runExperiment.isError && (
        <Reveal index={1}>
          <p role="alert" className="text-danger">
            {runExperiment.error instanceof ApiError
              ? (runExperiment.error.problem.detail ?? runExperiment.error.problem.title)
              : 'Failed to run experiment'}
          </p>
        </Reveal>
      )}

      {!result && !runExperiment.isPending && !runExperiment.isError && (
        <Reveal index={1}>
          <EmptyState
            icon={FlaskConical}
            title="Describe your test"
            description="Pick the property holding the variant, the event that means a user saw the test, and the event that counts as a conversion."
          />
        </Reveal>
      )}

      {result && result.variants.length === 0 && (
        <Reveal index={1}>
          <EmptyState
            icon={FlaskConical}
            title="No participants in this range"
            description="No users fired the exposure event with a variant assigned. Check the property name, or widen the date range."
          />
        </Reveal>
      )}

      {result && result.variants.length > 0 && (
        <Reveal index={1}>
          <ExperimentResults result={result} />
        </Reveal>
      )}
    </PageShell>
  );
}
