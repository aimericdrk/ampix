import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import { PageShell } from '../../../components/layout/PageShell';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/empty-state';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { Segmented } from '../../../components/ui/segmented';
import type { AttributedAccount, AttributionBreakdownRow } from '../../../lib/api/types';
import { formatExactNumber } from '../format';
import { useAttribution } from '../api';
import { DateRangeControl, useDateRange } from '../date-range';
import { ChartCard } from './charts/ChartCard';
import { BreakdownChart } from './charts/BreakdownChart';
import { KpiTile } from './charts/KpiTile';

/** What the SDK records when a user arrived with no campaign attached at all. */
const UNATTRIBUTED_LABEL = 'Direct / unknown';

/** The four first-touch dimensions, and what each one actually answers. */
const DIMENSIONS = [
  { id: 'source', label: 'Source', hint: 'The first-touch `utm_source` — where they came from.' },
  { id: 'campaign', label: 'Campaign', hint: 'The first-touch `utm_campaign` that brought them in.' },
  { id: 'medium', label: 'Medium', hint: 'The `utm_medium` on their first event (paid, organic, …).' },
  {
    id: 'referrer',
    label: 'Install referrer',
    hint: 'The raw Play Store install referrer string, when Android captured one.',
  },
] as const;

type DimensionId = (typeof DIMENSIONS)[number]['id'];

function label(value: string | null): string {
  return value ?? UNATTRIBUTED_LABEL;
}

/** A rate as a whole percentage, or an em dash when there is nothing to divide by. */
function rate(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const BREAKDOWN_COLUMNS: Array<DataTableColumn<AttributionBreakdownRow>> = [
  { key: 'value', header: 'Value', sortable: true, render: (row) => label(row.value) },
  {
    key: 'installs',
    header: 'Installs',
    align: 'right',
    sortable: true,
    render: (row) => formatExactNumber(row.installs),
  },
  {
    key: 'signups',
    header: 'Accounts created',
    align: 'right',
    sortable: true,
    render: (row) => formatExactNumber(row.signups),
  },
  {
    key: 'signup_rate',
    header: 'Install → account',
    align: 'right',
    sortable: true,
    // Sorts an unmeasurable rate to the bottom rather than treating it as 0%, which would rank
    // out-of-window sources as the worst performers.
    sortValue: (row) => row.signup_rate ?? -1,
    render: (row) => rate(row.signup_rate),
  },
];

const ACCOUNT_COLUMNS: Array<DataTableColumn<AttributedAccount>> = [
  {
    key: 'distinct_id',
    header: 'Account',
    sortable: true,
    render: (row) => (
      <span className="flex flex-col leading-tight">
        <span className="font-medium">{row.name ?? row.email ?? 'Unknown user'}</span>
        <span className="font-mono text-[11px] text-text-muted">{row.distinct_id}</span>
      </span>
    ),
  },
  {
    key: 'first_seen',
    header: 'First seen',
    sortable: true,
    render: (row) => formatDate(row.first_seen),
  },
  {
    key: 'signed_up_at',
    header: 'Signed up',
    sortable: true,
    // Never-signed-up accounts sort last on a descending sort, which is where they belong.
    sortValue: (row) => row.signed_up_at ?? '',
    render: (row) =>
      row.signed_up_at ? (
        formatDate(row.signed_up_at)
      ) : (
        <span className="text-text-muted">Not yet</span>
      ),
  },
  {
    key: 'first_utm_source',
    header: 'First-touch source',
    sortable: true,
    render: (row) => label(row.first_utm_source),
  },
  {
    key: 'first_utm_campaign',
    header: 'First-touch campaign',
    sortable: true,
    render: (row) => label(row.first_utm_campaign),
  },
  {
    key: 'utm_medium',
    header: 'Medium',
    sortable: true,
    render: (row) => label(row.utm_medium),
  },
  {
    key: 'install_referrer',
    header: 'Install referrer',
    sortable: false,
    render: (row) =>
      row.install_referrer ? (
        <span className="font-mono text-[11px]">{row.install_referrer}</span>
      ) : (
        <span className="text-text-muted">—</span>
      ),
  },
];

/**
 * Attribution — where the accounts created in this range came from.
 *
 * Two populations, side by side rather than one number: **installs** (everyone whose first-ever
 * event landed in the range) and **accounts created** (their first `$identify`). In a mobile app
 * those are not the same people, and the gap between them per campaign is the number worth acting
 * on — a source that drives a thousand curious installs and forty accounts is a different problem
 * from one that drives eighty installs and sixty accounts.
 *
 * Attribution is FIRST-touch throughout: a user is credited to the campaign that brought their
 * anonymous install in, not to whatever they had in hand on the day they eventually signed up.
 */
export function AttributionPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/attribution' });
  const { from, to } = useDateRange();
  const [dimension, setDimension] = useState<DimensionId>('source');

  const attribution = useAttribution(projectId, from, to);
  const data = attribution.data;

  const rowsByDimension: Record<DimensionId, AttributionBreakdownRow[]> = {
    source: data?.by_source ?? [],
    campaign: data?.by_campaign ?? [],
    medium: data?.by_medium ?? [],
    referrer: data?.by_referrer ?? [],
  };
  const rows = rowsByDimension[dimension];
  const activeDimension = DIMENSIONS.find((entry) => entry.id === dimension)!;

  const chartState = attribution.isPending
    ? 'loading'
    : attribution.isError
      ? 'error'
      : rows.length === 0
        ? 'empty'
        : 'ready';

  return (
    <PageShell
      projectId={projectId}
      title="Attribution"
      description="Where the accounts created in this range came from — installs and sign-ups side by side, per first-touch campaign."
      breadcrumbs={[{ label: 'Audience' }, { label: 'Attribution' }]}
      dateRangeControl={<DateRangeControl />}
    >
      <Reveal index={0}>
        <SectionGrid>
          <KpiTile
            label="Installs"
            value={data?.total_installs ?? 0}
            loading={attribution.isPending}
            hint="First-ever event in this range"
          />
          <KpiTile
            label="Accounts created"
            value={data?.total_signups ?? 0}
            loading={attribution.isPending}
            hint="First sign-in in this range"
          />
          <KpiTile
            label="Install → account"
            value={rate(data?.signup_rate ?? null)}
            loading={attribution.isPending}
            hint="Of the installs in this range"
          />
          <KpiTile
            label="Attributed sources"
            value={data?.by_source.filter((row) => row.value !== null).length ?? 0}
            loading={attribution.isPending}
            hint="Distinct first-touch sources"
          />
        </SectionGrid>
      </Reveal>

      {attribution.isError && (
        <Reveal index={1}>
          <p role="alert" className="text-danger">
            Failed to load attribution
          </p>
        </Reveal>
      )}

      <Reveal index={1} className="flex flex-col gap-6">
        <ChartCard
          title={`Accounts created by ${activeDimension.label.toLowerCase()}`}
          description={activeDimension.hint}
          state={chartState}
          emptyText="No attributed accounts in this range."
          exportImageName={`attribution-by-${dimension}`}
          action={
            <Segmented
              aria-label="Breakdown dimension"
              value={dimension}
              onValueChange={(value) => setDimension(value as DimensionId)}
              options={DIMENSIONS.map((entry) => ({ value: entry.id, label: entry.label }))}
              className="flex-wrap"
            />
          }
        >
          <BreakdownChart
            ariaLabel={`Installs and accounts created by ${activeDimension.label.toLowerCase()}`}
            stacked
            data={rows.map((row) => ({
              label: label(row.value),
              segments: [
                // Installs that never became an account, so the two segments sum to installs
                // rather than double-counting the users who did both.
                { key: 'Accounts created', value: row.signups },
                { key: 'Installs only', value: Math.max(0, row.installs - row.signups) },
              ],
            }))}
          />
        </ChartCard>

        {rows.length > 0 && (
          <DataTable
            caption={`Installs, accounts created, and the conversion between them, per ${activeDimension.label.toLowerCase()}`}
            columns={BREAKDOWN_COLUMNS}
            rows={rows}
            rowKey={(row) => row.value ?? '__unattributed__'}
            initialSort={{ key: 'installs', dir: 'desc' }}
            exportFilename={`attribution-by-${dimension}`}
          />
        )}
      </Reveal>

      <Reveal index={2}>
        {data && data.accounts.length === 0 && !attribution.isPending ? (
          <EmptyState
            icon={Inbox}
            title="No accounts created in this range"
            description="Widen the date range, or check that your SDK is capturing campaign parameters."
          />
        ) : (
          data && (
            <DataTable
              caption="Each account created in this range and the campaign it is attributed to"
              columns={ACCOUNT_COLUMNS}
              rows={data.accounts}
              rowKey={(row) => row.distinct_id}
              initialSort={{ key: 'first_seen', dir: 'desc' }}
              exportFilename="accounts-attribution"
            />
          )
        )}
      </Reveal>
    </PageShell>
  );
}
