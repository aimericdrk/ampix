import { useParams } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageShell } from '../../../components/layout/PageShell';
import { Button } from '../../../components/ui/button';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { Segmented } from '../../../components/ui/segmented';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import type { JourneyOutcome, JourneyResponse } from '../../../lib/api/types';
import { ChartCard } from '../../analytics/components/charts/ChartCard';
import { KpiTile } from '../../analytics/components/charts/KpiTile';
import { DateRangeControl, useDateRange } from '../../analytics/date-range';
import { useProjects } from '../../projects/api';
import {
  useAnalyzeSubscriptionJourney,
  useSubscriptionJourney,
  type JourneyParams,
} from '../api';
import { FrequencyTable, PathTimeline, SummaryTable } from './journey-blocks';
import { JourneyAnalysisPanel, JourneyPayloadActions } from './journey-analysis';

const OUTCOME_OPTIONS = [
  { value: 'subscribe', label: 'Before subscribing' },
  { value: 'refund', label: 'Before refunding' },
];

/** Matches the server's clamps, so the control can never ask for something it will not get. */
const WINDOW_OPTIONS = [
  { value: '3', label: '3d' },
  { value: '7', label: '7d' },
  { value: '14', label: '14d' },
  { value: '30', label: '30d' },
];

/** The short name for the cohort's table column. */
const COHORT_LABEL: Record<JourneyOutcome, string> = {
  subscribe: 'Subscribers',
  refund: 'Refunders',
};

/** The KPI tiles say what the group DID rather than what it is called: "Subscribers" alone
 *  collides with the global filter bar's own subscription chip, and "Everyone else" repeats a
 *  column header further down the page. */
const COHORT_TILE_LABEL: Record<JourneyOutcome, string> = {
  subscribe: 'Subscribed in range',
  refund: 'Refunded in range',
};

const OUTCOME_STEP_LABEL: Record<JourneyOutcome, string> = {
  subscribe: 'Subscribed',
  refund: 'Refunded',
};

/** Below this the comparison is noise dressed as a finding, and the page says so rather than
 *  rendering confident-looking numbers over a handful of users. */
const THIN_COHORT = 30;

function friendlyAnalyzeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.problem.status === 503) return "AI analysis isn't set up (no Mistral key)";
    if (error.problem.status === 502) return "Couldn't reach the AI provider — try again";
    if (error.problem.status === 422) return 'The AI returned something unreadable — try again';
  }
  return 'Something went wrong analysing the journey — try again';
}

/**
 * MyRevenueCat → Journey. What users actually do in the run-up to subscribing or being refunded,
 * measured against a control cohort that did neither.
 *
 * The control is the point: "subscribers viewed the paywall 2.4 times" is not a finding until you
 * know everyone else viewed it 0.3 times. So every block here is a comparison, and the page leads
 * with both cohort sizes — a lift computed over 6 users is not worth reading, and the page says so
 * instead of letting the number imply otherwise.
 *
 * The same payload backs three consumers: this page, the in-product AI analysis, and an external
 * agent fetching `GET .../subscriptions/journey` directly. `JourneyPayloadActions` exposes the last
 * of those without a round trip — the report is already in the browser.
 */
export function RcJourneyPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/journey' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const { from, to } = useDateRange();
  const { toast } = useToast();

  const [outcome, setOutcome] = useState<JourneyOutcome>('subscribe');
  const [windowDays, setWindowDays] = useState(7);

  const params: JourneyParams = useMemo(
    () => ({ outcome, from, to, windowDays, pathSteps: 8 }),
    [outcome, from, to, windowDays],
  );

  const journey = useSubscriptionJourney(projectId, params);
  const analyze = useAnalyzeSubscriptionJourney(projectId);

  const runAnalysis = () => {
    analyze.mutate(params, {
      onError: (error) => toast({ title: friendlyAnalyzeError(error), variant: 'error' }),
    });
  };

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented
        aria-label="Outcome to analyse"
        options={OUTCOME_OPTIONS}
        value={outcome}
        onValueChange={(value) => setOutcome(value as JourneyOutcome)}
      />
      <Segmented
        aria-label="Look-back window"
        options={WINDOW_OPTIONS}
        value={String(windowDays)}
        onValueChange={(value) => setWindowDays(Number(value))}
      />
      <DateRangeControl />
    </div>
  );

  // Same discipline as the other MyRevenueCat pages: don't render below until `useProjects()` has
  // resolved, or a still-loading project briefly flashes an empty shell.
  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Journey"
        description="What users do before subscribing or refunding."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Journey' }]}
      >
        {null}
      </PageShell>
    );
  }

  const report = journey.data;

  return (
    <PageShell
      projectId={projectId}
      title="Journey"
      description="What users do before subscribing or refunding, against everyone who did neither."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Journey' }]}
      actions={header}
    >
      {journey.isError && (
        <p role="alert" className="text-sm text-danger">
          Couldn&apos;t load the journey for this range.
        </p>
      )}

      {report && (
        <Reveal>
          <div className="flex flex-col gap-6">
            <JourneyScope report={report} />

            <SectionGrid min={220}>
              <KpiTile
                label={COHORT_TILE_LABEL[outcome]}
                value={report.cohort.users}
                hint="Users with this outcome — the measured cohort"
              />
              <KpiTile
                label="Control cohort"
                value={report.control.users}
                hint="Comparable users who did not"
              />
            </SectionGrid>

            {(report.cohort.users < THIN_COHORT || report.control.users < THIN_COHORT) && (
              <p
                role="status"
                className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-text-muted"
              >
                Fewer than {THIN_COHORT} users on one side of this comparison. Every figure below is
                still exact, but a difference this thin is as likely to be chance as signal — widen
                the date range before drawing a conclusion from it.
              </p>
            )}

            <ChartCard title="Cohort vs. everyone else" state="ready">
              <SummaryTable metrics={report.summary} cohortLabel={COHORT_LABEL[outcome]} />
            </ChartCard>

            <ChartCard
              title="The typical path"
              description={`The most common event at each position before the outcome, and how much of the cohort actually took it. A low share means there is no single common path — which is itself the finding.`}
              state="ready"
            >
              <PathTimeline
                steps={report.path}
                outcomeLabel={OUTCOME_STEP_LABEL[outcome]}
                cohortUsers={report.cohort.users}
              />
            </ChartCard>

            <ChartCard
              title="What they did, and how much more"
              description="Occurrences per user in the window, averaged over every user in each group — including those who never did it, so the two columns compare like with like."
              state={report.frequency.length > 0 ? 'ready' : 'empty'}
              emptyText="No events recorded in the window for either group."
            >
              <FrequencyTable
                rows={report.frequency}
                cohortLabel={COHORT_LABEL[outcome]}
                nameHeader="Event"
                caption="Events per user, cohort versus control"
              />
            </ChartCard>

            <ChartCard
              title="Screens they saw"
              state={report.screens.length > 0 ? 'ready' : 'empty'}
              emptyText="No screen views recorded in the window for either group."
            >
              <FrequencyTable
                rows={report.screens}
                cohortLabel={COHORT_LABEL[outcome]}
                nameHeader="Screen"
                caption="Screen views per user, cohort versus control"
              />
            </ChartCard>

            <ChartCard
              title="AI analysis"
              description="Reads the exact report above and reports only what differs between the two groups."
              state="ready"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <JourneyPayloadActions report={report} outcome={outcome} />
                  <Button type="button" onClick={runAnalysis} disabled={analyze.isPending}>
                    <Sparkles aria-hidden="true" size={16} />
                    {analyze.isPending ? 'Analysing…' : 'Analyse'}
                  </Button>
                </div>
              }
            >
              <JourneyAnalysisPanel
                analysis={analyze.data}
                pending={analyze.isPending}
                outcome={outcome}
              />
            </ChartCard>
          </div>
        </Reveal>
      )}
    </PageShell>
  );
}

/** What was actually measured, in the same words the model is given. A cohort definition that
 *  lives only in a tooltip is a cohort definition nobody reads. */
function JourneyScope({ report }: { report: JourneyResponse }) {
  const { definition } = report;
  return (
    <dl className="grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
          Measured cohort
        </dt>
        <dd className="mt-1">{definition.outcome_criteria}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
          Compared against
        </dt>
        <dd className="mt-1">{definition.control_criteria}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">Window</dt>
        <dd className="mt-1 text-text-muted">
          The {definition.window_days} days before each user&apos;s anchor event.{' '}
          {definition.excluded_event_prefix}* subscription events are excluded from the behaviour —
          they are the outcome, not the run-up to it.
        </dd>
      </div>
    </dl>
  );
}
