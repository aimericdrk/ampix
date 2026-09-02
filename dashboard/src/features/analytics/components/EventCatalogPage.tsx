import { useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import { PageShell } from '../../../components/layout/PageShell';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { Input } from '../../../components/ui/input';
import { Reveal } from '../../../components/ui/reveal';
import type { EventSummaryResponse, MetaEventsResponse, MetaProperty } from '../../../lib/api/types';
import { useMetaEvents, useMetaProperties } from '../api';
import { useEventSummary } from '../../projects/api';
import { ChartCard } from './charts/ChartCard';
import { KpiTile } from './charts/KpiTile';
import { useEventDescriptions, type UseEventDescriptionsResult } from '../event-descriptions';

/**
 * Who emitted an event name, over its whole all-time history. `mixed` is a real and meaningful
 * state — the same name written both by the SDK and by a backend — not a fallback, so it gets its
 * own label rather than being collapsed into a majority winner. `none` means there is no volume to
 * classify: the name came from `meta/events` alone, with no all-time row behind it.
 */
type CatalogSource = 'client' | 'server' | 'mixed' | 'none';

interface CatalogEvent {
  name: string;
  count: number;
  clientCount: number;
  serverCount: number;
  source: CatalogSource;
  isAuto: boolean;
}

function classifySource(clientCount: number, serverCount: number): CatalogSource {
  if (clientCount > 0 && serverCount > 0) return 'mixed';
  if (clientCount > 0) return 'client';
  if (serverCount > 0) return 'server';
  return 'none';
}

/**
 * Joins `meta/events` (names seen in the last 30 days) with `events/summary`'s `by_event`
 * (all-time counts + the client/server split) by name — a UNION of both sources (feat-15 §4): an
 * event tracked only in the last 30 days but with no all-time row shows `0` (and so has no source
 * to report), and an older event absent from `meta/events` but present in the all-time summary
 * still gets listed.
 */
function buildCatalog(
  metaEvents: MetaEventsResponse | undefined,
  summary: EventSummaryResponse | undefined,
): CatalogEvent[] {
  const rowByName = new Map(summary?.by_event.map((row) => [row.event, row]) ?? []);
  const names = new Set<string>(metaEvents?.events ?? []);
  for (const row of summary?.by_event ?? []) names.add(row.event);

  return Array.from(names).map((name) => {
    const row = rowByName.get(name);
    const clientCount = row?.client_count ?? 0;
    const serverCount = row?.server_count ?? 0;
    return {
      name,
      count: row?.count ?? 0,
      clientCount,
      serverCount,
      source: classifySource(clientCount, serverCount),
      isAuto: name.startsWith('$'),
    };
  });
}

/** The "$ auto" / "manual" pill. */
function EventKindBadge({ isAuto }: { isAuto: boolean }) {
  return <Badge variant={isAuto ? 'accent' : 'outline'}>{isAuto ? '$ auto' : 'manual'}</Badge>;
}

const SOURCE_BADGE: Record<
  Exclude<CatalogSource, 'none'>,
  { label: string; variant: 'info' | 'success' | 'warning' }
> = {
  client: { label: 'client', variant: 'info' },
  server: { label: 'server', variant: 'success' },
  // `mixed` is styled as a warning on purpose: one name arriving from both the SDK and a backend
  // is usually a naming collision or double instrumentation, and is worth noticing.
  mixed: { label: 'mixed', variant: 'warning' },
};

/**
 * The client/server pill, with the exact split spelled out underneath when an event has volume on
 * both sides — the badge alone would hide which side dominates.
 */
function EventSourceCell({ event }: { event: CatalogEvent }) {
  if (event.source === 'none') {
    return (
      <span
        className="text-text-muted"
        title="No events recorded yet, so there is no source to report"
      >
        —
      </span>
    );
  }

  const { label, variant } = SOURCE_BADGE[event.source];
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={variant}>{label}</Badge>
      {event.source === 'mixed' && (
        <span className="text-xs text-text-muted">
          {event.clientCount.toLocaleString()} client · {event.serverCount.toLocaleString()} server
        </span>
      )}
    </div>
  );
}

/**
 * An inline editable description cell: a small text input seeded from the stored description,
 * saved optimistically on every change so the localStorage-backed map (and hence every other
 * cell reading the same event) stays current without an explicit "Save" step.
 */
function EventDescriptionCell({
  event,
  descriptions,
}: {
  event: string;
  descriptions: UseEventDescriptionsResult;
}) {
  const [value, setValue] = useState(() => descriptions.get(event));

  return (
    <Input
      aria-label={`Description for ${event}`}
      placeholder="What does this event mean?"
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        descriptions.set(event, next);
      }}
      className="h-9 min-w-[14rem]"
    />
  );
}

/**
 * The Event Catalog / Data Dictionary (feat-15) — a searchable, sortable reference for every
 * event the project tracks: name, whether it's autocaptured (`$name`) or manual, its all-time
 * volume, an editable free-text description (feat-15 §3), and — on expand — its known
 * properties. Composes existing metadata endpoints (`meta/events`, `events/summary`,
 * `meta/properties`) with no new backend surface; descriptions live in `localStorage` for now
 * (§7: promotable to a shared store later).
 */
export function EventCatalogPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/events' });
  const metaEvents = useMetaEvents(projectId);
  const eventSummary = useEventSummary(projectId);
  // `meta/properties` has no per-event linkage in this API version (feat-15 §3/T1 note) — fetched
  // once, unconditionally, and shown for whichever single event is currently expanded below.
  const metaProperties = useMetaProperties(projectId);
  const descriptions = useEventDescriptions(projectId);

  const [search, setSearch] = useState('');
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  const isPending = metaEvents.isPending || eventSummary.isPending;
  const isError = metaEvents.isError || eventSummary.isError;

  const events = useMemo(
    () => buildCatalog(metaEvents.data, eventSummary.data),
    [metaEvents.data, eventSummary.data],
  );

  const trimmedSearch = search.trim().toLowerCase();
  const filteredEvents =
    trimmedSearch.length === 0
      ? events
      : events.filter((event) => event.name.toLowerCase().includes(trimmedSearch));

  const distinctCount = events.length;
  const autoCount = events.filter((event) => event.isAuto).length;
  const manualCount = distinctCount - autoCount;
  const totalVolume = events.reduce((sum, event) => sum + event.count, 0);
  const clientVolume = events.reduce((sum, event) => sum + event.clientCount, 0);
  const serverVolume = events.reduce((sum, event) => sum + event.serverCount, 0);

  const columns: Array<DataTableColumn<CatalogEvent>> = [
    {
      key: 'name',
      header: 'Event',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.name}</span>
          <EventKindBadge isAuto={row.isAuto} />
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      sortable: true,
      render: (row) => <EventSourceCell event={row} />,
      // Sorting/CSV read the label, not the enum, so `none` lands last under an asc sort and the
      // export column matches what the badge says.
      sortValue: (row) => (row.source === 'none' ? '—' : SOURCE_BADGE[row.source].label),
    },
    {
      key: 'count',
      header: 'Volume',
      align: 'right',
      sortable: true,
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => <EventDescriptionCell event={row.name} descriptions={descriptions} />,
    },
    {
      key: 'properties',
      header: 'Properties',
      render: (row) => (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setExpandedEvent((current) => (current === row.name ? null : row.name))}
          aria-expanded={expandedEvent === row.name}
        >
          {expandedEvent === row.name ? 'Hide properties' : 'Properties'}
        </Button>
      ),
    },
  ];

  const isEmpty = !isPending && !isError && distinctCount === 0;

  return (
    <PageShell
      projectId={projectId}
      title="Events"
      description="Every event this project tracks — its volume, whether it came from the SDK or a backend, whether it's autocaptured or manual, and a shared description of what it means."
      breadcrumbs={[{ label: 'Explore' }, { label: 'Events' }]}
    >
      {isPending && (
        <Reveal index={0}>
          <p role="status">Loading events…</p>
        </Reveal>
      )}
      {isError && (
        <Reveal index={0}>
          <p role="alert" className="text-danger">
            Failed to load events
          </p>
        </Reveal>
      )}

      {isEmpty && (
        <Reveal index={0}>
          <EmptyState icon={Inbox} title="No events tracked yet." />
        </Reveal>
      )}

      {!isPending && !isError && !isEmpty && (
        <Reveal index={1} className="flex flex-col gap-6">
          <SectionGrid>
            <KpiTile label="Distinct events" value={distinctCount} />
            <KpiTile label="Autocaptured" value={autoCount} />
            <KpiTile label="Manual" value={manualCount} />
            <KpiTile label="Total volume" value={totalVolume} />
            <KpiTile label="From client" value={clientVolume} />
            <KpiTile label="From server" value={serverVolume} />
          </SectionGrid>

          <div className="max-w-sm">
            <label htmlFor="event-catalog-search" className="mb-1 block text-sm font-medium">
              Search events
            </label>
            <Input
              id="event-catalog-search"
              placeholder="e.g. checkout"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <ChartCard title="Events">
            <DataTable
              columns={columns}
              rows={filteredEvents}
              caption="Events tracked by this project"
              initialSort={{ key: 'count', dir: 'desc' }}
              rowKey={(row) => row.name}
              exportFilename="events"
            />
          </ChartCard>
        </Reveal>
      )}

      {expandedEvent && (
        <Reveal index={2}>
          <ChartCard title={`Properties for ${expandedEvent}`}>
            <EventPropertiesList
              properties={metaProperties.data?.properties ?? []}
              isPending={metaProperties.isPending}
              isError={metaProperties.isError}
            />
          </ChartCard>
        </Reveal>
      )}
    </PageShell>
  );
}

function EventPropertiesList({
  properties,
  isPending,
  isError,
}: {
  properties: MetaProperty[];
  isPending: boolean;
  isError: boolean;
}) {
  if (isPending) return <p role="status">Loading properties…</p>;
  if (isError) return (
    <p role="alert" className="text-danger">
      Failed to load properties
    </p>
  );
  if (properties.length === 0) return <EmptyState icon={Inbox} title="No known properties." />;

  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {properties.map((property) => (
        <li key={property.name} className="flex items-center gap-2">
          <span className="font-mono text-xs">{property.name}</span>
          <span className="text-xs text-text-muted">{property.type}</span>
        </li>
      ))}
    </ul>
  );
}
