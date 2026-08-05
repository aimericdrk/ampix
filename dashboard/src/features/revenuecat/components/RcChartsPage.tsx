import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { fieldLook } from '../../../components/ui/input';
import { useProjects } from '../../projects/api';
import { DateRangeControl, useDateRange } from '../../analytics/date-range';
import { formatCurrency } from '../../analytics/format';
import { ChartCard } from '../../analytics/components/charts/ChartCard';
import { ComparisonTrend } from '../../analytics/components/charts/ComparisonTrend';
import { KpiTile } from '../../analytics/components/charts/KpiTile';
import {
  useRcActiveSubscriptions,
  useRcMrr,
  useRcRevenue,
  type RcGranularity,
} from '../purchase-metrics-api';

/** Shown both as the page-level alert and as each ChartCard's error slot when the purchase service
 *  is unset/unreachable (spec §3 gating & degradation). */
const PURCHASE_SERVICE_ERROR =
  'The purchase service isn’t configured or is unreachable.';

/** Maps a query's loading/error/empty flags onto `ChartCard`'s `state` prop (mirrors RcOverviewPage). */
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

/**
 * MyRevenueCat → Charts. The first dashboard surface wired to the billing-authority `mobile_purchase`
 * service (via `purchaseApiFetch`), rather than the legacy `mobile_analytics` RC mirror the Overview/
 * Conversion pages read. Three time series — exact Revenue, approximated MRR, approximated Active
 * Subscriptions — plus their headline KPIs, mirroring `RcOverviewPage`'s composition.
 */
export function RcChartsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/charts' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const { from, to } = useDateRange();
  const [granularity, setGranularity] = useState<RcGranularity>('day');

  // Don't start the purchase-service queries until the range is set. Hooks are called
  // unconditionally (rules of hooks); the early return comes after.
  const enabled = from.length > 0 && to.length > 0;
  const revenue = useRcRevenue(projectId, from, to, granularity, { enabled });
  const mrr = useRcMrr(projectId, from, to, granularity, { enabled });
  const activeSubs = useRcActiveSubscriptions(projectId, from, to, granularity, { enabled });

  // Don't render below until `useProjects()` has resolved, or a still-loading flag briefly
  // flashes an empty shell.
  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Charts"
        description="Revenue, MRR, and active subscriptions over time."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Charts' }]}
      >
        {null}
      </PageShell>
    );
  }

  const anyPending = revenue.isPending || mrr.isPending || activeSubs.isPending;
  const anyError = revenue.isError || mrr.isError || activeSubs.isError;

  const revenueCurrency = revenue.data?.currency ?? 'USD';
  const mrrCurrency = mrr.data?.currency ?? 'USD';

  const revenueRows = (revenue.data?.series ?? []).map((point) => ({
    bucket: point.bucket,
    revenue: point.amountCents / 100,
  }));
  const mrrRows = (mrr.data?.series ?? []).map((point) => ({
    bucket: point.bucket,
    mrr: point.mrrCents / 100,
  }));
  const activeRows = (activeSubs.data?.series ?? []).map((point) => ({
    bucket: point.bucket,
    active: point.count,
  }));

  const currentMrr = mrr.data ? formatCurrency(mrr.data.mrrCents / 100, mrrCurrency) : '—';
  const currentActive = activeSubs.data?.current ?? 0;
  const revenueInRange = revenue.data
    ? formatCurrency(revenue.data.totalCents / 100, revenueCurrency)
    : '—';

  const unattributed = mrr.data?.unattributedActiveCount ?? 0;
  const otherCurrencies = (revenue.data?.byCurrency ?? []).filter(
    (entry) => entry.currency !== revenueCurrency,
  );

  const granularityControl = (
    <label className="flex items-center gap-2 text-sm text-text-muted">
      <span className="sr-only">Granularity</span>
      <select
        aria-label="Granularity"
        className={fieldLook}
        value={granularity}
        onChange={(event) => setGranularity(event.target.value as RcGranularity)}
      >
        <option value="day">Daily</option>
        <option value="week">Weekly</option>
        <option value="month">Monthly</option>
      </select>
    </label>
  );

  return (
    <PageShell
      projectId={projectId}
      title="Charts"
      description="Revenue, MRR, and active subscriptions over time, from the purchase service."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Charts' }]}
      dateRangeControl={
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeControl />
          {granularityControl}
        </div>
      }
    >
      {/* Page-level loading/error announcement, mirroring RcOverviewPage/RcConversionPage:
          `ChartCard`'s own error branch has no live region, so a failed fetch would otherwise be
          silent to screen readers. */}
      {anyPending && (
        <Reveal index={0}>
          <p role="status">Loading purchase metrics…</p>
        </Reveal>
      )}
      {anyError && (
        <Reveal index={0}>
          <p role="alert" className="text-danger">
            {PURCHASE_SERVICE_ERROR}
          </p>
        </Reveal>
      )}

      <Reveal index={0}>
        <SectionGrid>
          {anyPending ? (
            // Generic (unlabeled) skeleton tiles while any of the three metrics is still in
            // flight — mirrors RcOverviewPage's `{data && (...)}` gate: the *real* KpiTiles (and
            // their labels) don't mount until every metric has resolved, so a page reader/test
            // waiting on a KPI label never observes it ahead of its value.
            <>
              <KpiTile label="Loading…" value="" loading />
              <KpiTile label="Loading…" value="" loading />
              <KpiTile label="Loading…" value="" loading />
            </>
          ) : (
            <>
              <KpiTile label="Current MRR" value={currentMrr} unfiltered />
              <KpiTile label="Active subscribers" value={currentActive} unfiltered />
              <KpiTile label="Revenue in range" value={revenueInRange} />
            </>
          )}
        </SectionGrid>
      </Reveal>

      <Reveal index={1}>
        <ChartCard
          title="Revenue over time"
          description="Exact revenue from the transaction ledger, by bucket."
          state={chartState(revenue.isPending, revenue.isError, revenueRows.length === 0)}
          errorText={PURCHASE_SERVICE_ERROR}
          exportImageName="rc-revenue-over-time"
        >
          <ComparisonTrend
            current={revenueRows}
            xKey="bucket"
            valueKey="revenue"
            label={`Revenue (${revenueCurrency})`}
            ariaLabel="Revenue over time"
          />
        </ChartCard>
      </Reveal>

      <Reveal index={2}>
        <ChartCard
          title="MRR"
          description="Monthly recurring revenue, approximated from current subscriptions."
          state={chartState(mrr.isPending, mrr.isError, mrrRows.length === 0)}
          errorText={PURCHASE_SERVICE_ERROR}
          exportImageName="rc-mrr-over-time"
        >
          <ComparisonTrend
            current={mrrRows}
            xKey="bucket"
            valueKey="mrr"
            label={`MRR (${mrrCurrency})`}
            ariaLabel="MRR over time"
          />
        </ChartCard>
      </Reveal>

      <Reveal index={3}>
        <ChartCard
          title="Active subscriptions"
          description="Active subscriptions per bucket, approximated from current state."
          state={chartState(activeSubs.isPending, activeSubs.isError, activeRows.length === 0)}
          errorText={PURCHASE_SERVICE_ERROR}
          exportImageName="rc-active-subscriptions"
        >
          <ComparisonTrend
            current={activeRows}
            xKey="bucket"
            valueKey="active"
            label="Active count"
            ariaLabel="Active subscriptions over time"
          />
        </ChartCard>
      </Reveal>

      <Reveal index={4}>
        <p className="text-xs text-text-muted">
          MRR and active-subscription history are approximated from current subscription state and
          understate past churn; exact daily snapshots are a scheduled follow-up. Revenue over time is
          exact.
          {unattributed > 0 &&
            ` ${unattributed} active subscription(s) are excluded from MRR because their product period couldn’t be resolved.`}
          {` Amounts are shown in ${revenueCurrency}.`}
          {otherCurrencies.length > 0 &&
            ` Other currencies (${otherCurrencies
              .map((entry) => entry.currency)
              .join(', ')}) are reported separately and not converted.`}
        </p>
      </Reveal>
    </PageShell>
  );
}
