import { useMemo, useState, type ReactNode } from 'react';
import { useEffect } from 'react';
import { Avatar, AvatarFallback } from '../../../components/ui/avatar';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { CollapsibleSection } from '../../../components/ui/CollapsibleSection';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import { cn } from '../../../lib/cn';
import { ApiError } from '../../../lib/api/problem';
import type {
  ClickHeatmapResponse,
  HeatmapGrid,
  ScreenPathsResponse,
  UserEventContext,
  UserRecentEvent,
} from '../../../lib/api/types';
import { formatExactNumber } from '../format';
import { useRunClickHeatmap, useRunScreenPaths, useScreens, useUserProfile } from '../api';
import { FavoriteButton } from '../../favorites/FavoriteButton';
import { useFavorites } from '../../favorites/favorites';
import { useRecents } from '../../favorites/recents';
import { defaultDate } from './builder-controls';
import { HeatmapCanvas, HeatmapLegend } from './HeatmapCanvas';
import { PathMap } from './PathMap';

/** The screen-view autocapture event (contracts §4) — drives the per-user screen-path diagram. */
const SCREEN_VIEW_EVENT = '$screen_view';
const HEATMAP_GRID: HeatmapGrid = { cols: 20, rows: 40 };

/** Device/app context fields, in display order, with friendly labels. */
const DEVICE_FIELDS: ReadonlyArray<readonly [keyof UserEventContext, string]> = [
  ['os', 'OS'],
  ['os_version', 'OS version'],
  ['device_model', 'Device model'],
  ['device_manufacturer', 'Manufacturer'],
  ['app_version', 'App version'],
  ['app_build', 'App build'],
  ['locale', 'Locale'],
  ['timezone', 'Timezone'],
  ['network', 'Network'],
  ['sdk_version', 'SDK version'],
];

/**
 * The user's screen sequence, derived from `recent_events`: keep `$screen_view` events that carry a
 * screen name, put them back into chronological order (the feed is newest-first), then collapse
 * consecutive duplicate screens so "home → home → cart" reads as "home → cart".
 */
function deriveScreenPath(events: UserRecentEvent[]): string[] {
  const screens = events
    .filter((e) => e.event === SCREEN_VIEW_EVENT && e.screen_name)
    .map((e) => e.screen_name as string)
    .reverse();
  return screens.filter((name, i) => i === 0 || name !== screens[i - 1]);
}

/** First two alphanumeric characters of the id, for the header monogram. */
function monogram(distinctId: string): string {
  const letters = distinctId.replace(/[^a-z0-9]/gi, '');
  return (letters.slice(0, 2) || distinctId.slice(0, 2) || '?').toUpperCase();
}

/** Pretty-render an arbitrary property value: typed badges/mono, never a raw JSON dump. */
function formatValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-text-muted">—</span>;
  }
  if (typeof value === 'boolean') {
    return <Badge variant={value ? 'accent' : 'default'}>{value ? 'true' : 'false'}</Badge>;
  }
  if (typeof value === 'number') {
    return <span className="tabular-nums">{value.toLocaleString()}</span>;
  }
  if (typeof value === 'object') {
    return <code className="break-all font-mono text-xs">{JSON.stringify(value)}</code>;
  }
  return <span className="break-words">{String(value)}</span>;
}

/** A definition list of key → pretty value; keys shown verbatim (mono), values right-aligned. */
function PropertyGrid({ entries }: { entries: Array<[string, unknown]> }) {
  if (entries.length === 0) {
    return <p className="text-sm text-text-muted">None.</p>;
  }
  return (
    <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="truncate font-mono text-xs text-text-muted" title={key}>
            {key}
          </dt>
          <dd className="min-w-0 break-words text-right">{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The per-user profile shown as a modal (feat: user info in a popup instead of a dedicated page).
 * Three columns: the LEFT gathers everything about the person (user + device properties, then the
 * collapsed-by-default screen path, path map and tap heatmap); the CENTRE is the activity timeline
 * whose events are clickable; the RIGHT is a rich, pretty-printed detail panel for the selected
 * event (the latest event by default). Opened from the Users list and from deep-links / favorites.
 */
export function UserProfileModal({
  projectId,
  distinctId,
  onClose,
}: {
  projectId: string;
  distinctId: string;
  onClose: () => void;
}) {
  const { data, isPending, isError, error } = useUserProfile(projectId, distinctId);
  const screenPath = useMemo(
    () => (data ? deriveScreenPath(data.recent_events) : []),
    [data],
  );
  const favorites = useFavorites(projectId);
  const recents = useRecents(projectId);
  const recordRecent = recents.record;

  // The event whose detail is shown on the right. `null` means "follow the latest" (recent_events
  // is newest-first, so index 0). Clicking a timeline event pins it here.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const events = data?.recent_events ?? [];
  const selectedEvent = events.find((e) => e.insert_id === selectedId) ?? events[0];

  // Country: prefer the profile row (set via people.set); otherwise fall back to the most recent
  // event carrying a `country` super property (registerSuperProperties rides on events, not the
  // profile), so it still surfaces here.
  const derivedCountry = useMemo(
    () => events.find((e) => e.properties.country != null && e.properties.country !== '')?.properties.country,
    [events],
  );
  // Device context: the most recent event that actually captured one (falls back to the newest).
  const device = useMemo(
    () => events.find((e) => e.context.os !== '')?.context ?? events[0]?.context,
    [events],
  );

  const userPropertyEntries: Array<[string, unknown]> = useMemo(() => {
    if (!data) return [];
    const profileEntries = Object.entries(data.profile);
    const hasCountry = profileEntries.some(([k]) => k === 'country');
    return hasCountry || derivedCountry == null
      ? profileEntries
      : [['country', derivedCountry], ...profileEntries];
  }, [data, derivedCountry]);

  // Record this profile visit in Recents (feat-13 §3) as soon as it's opened — keyed on `distinctId`.
  useEffect(() => {
    recordRecent({ type: 'user', id: distinctId, name: distinctId });
  }, [distinctId, recordRecent]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[92vh] w-[96vw] max-w-6xl flex-col gap-0 overflow-hidden p-0"
      >
        {/* Header: monogram + id + at-a-glance stats, with favorite + close on the right. */}
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar size="lg" aria-hidden className="flex-none">
              <AvatarFallback className="text-sm font-semibold">
                {monogram(distinctId)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <DialogTitle className="truncate font-mono text-base font-semibold">
                {distinctId}
              </DialogTitle>
              {data && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                  <span>
                    First seen{' '}
                    <span className="font-medium text-text">
                      {new Date(data.first_seen).toLocaleDateString()}
                    </span>
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    Last seen{' '}
                    <span className="font-medium text-text">
                      {new Date(data.last_seen).toLocaleDateString()}
                    </span>
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    <span className="font-medium text-text">
                      {formatExactNumber(data.event_count)}
                    </span>{' '}
                    events
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-none items-center gap-1.5">
            <FavoriteButton
              name={distinctId}
              isFavorite={favorites.isFavorite('user', distinctId)}
              onToggle={() => favorites.toggle({ type: 'user', id: distinctId, name: distinctId })}
            />
            <DialogClose
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-chart-surface hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </DialogClose>
          </div>
        </header>

        {/* Scrollable body. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {isPending && <p role="status">Loading user profile…</p>}
          {isError && (
            <p role="alert" className="text-danger">
              {error instanceof ApiError ? error.problem.title : 'Failed to load user profile'}
            </p>
          )}

          {data && (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.1fr)]">
              {/* LEFT — everything about the person. */}
              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>User properties</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PropertyGrid entries={userPropertyEntries} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Device properties</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PropertyGrid
                      entries={DEVICE_FIELDS.filter(([key]) => device?.[key]).map(([key, label]) => [
                        label,
                        device![key],
                      ])}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <CollapsibleSection title="Screen path" defaultOpen={false}>
                      {screenPath.length === 0 ? (
                        <p className="text-text-muted">No screen views recorded.</p>
                      ) : (
                        <ol className="flex flex-wrap items-center gap-2 text-sm">
                          {screenPath.map((name, i) => (
                            <li key={`${name}-${i}`} className="flex items-center gap-2">
                              {i > 0 && (
                                <span aria-hidden className="text-text-muted">
                                  →
                                </span>
                              )}
                              <Badge variant="outline" className="px-2.5 py-1 text-sm font-medium">
                                {name}
                              </Badge>
                            </li>
                          ))}
                        </ol>
                      )}
                    </CollapsibleSection>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <CollapsibleSection title="Path map" defaultOpen={false}>
                      <UserPathMap projectId={projectId} distinctIds={data.distinct_ids} />
                    </CollapsibleSection>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <CollapsibleSection title="Tap heatmap" defaultOpen={false}>
                      <UserTapHeatmap projectId={projectId} distinctIds={data.distinct_ids} />
                    </CollapsibleSection>
                  </CardContent>
                </Card>
              </div>

              {/* CENTRE — the activity timeline; each event selects itself on click. */}
              <Card className="border-accent/30">
                <CardContent>
                  <CollapsibleSection title="Activity timeline" defaultOpen>
                    {events.length === 0 ? (
                      <p className="text-text-muted">No recent events.</p>
                    ) : (
                      <div
                        className="max-h-[62vh] overflow-y-auto pr-1"
                        data-testid="activity-timeline-scroll"
                      >
                        <ol className="flex flex-col gap-1 border-l border-border pl-4 text-sm">
                          {events.map((event) => {
                            const isSelected = event.insert_id === selectedEvent?.insert_id;
                            return (
                              <li key={event.insert_id} className="relative">
                                <span
                                  aria-hidden
                                  className={cn(
                                    'absolute -left-[1.3125rem] top-2.5 h-2.5 w-2.5 rounded-full border-2 border-surface',
                                    isSelected ? 'bg-accent ring-2 ring-accent/30' : 'bg-accent',
                                  )}
                                />
                                <button
                                  type="button"
                                  aria-pressed={isSelected}
                                  onClick={() => setSelectedId(event.insert_id)}
                                  className={cn(
                                    'w-full rounded-md px-2 py-1.5 text-left transition-colors',
                                    isSelected
                                      ? 'bg-accent/10 ring-1 ring-accent/40'
                                      : 'hover:bg-chart-surface',
                                  )}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium">{event.event}</span>
                                    {event.screen_name && (
                                      <Badge variant="outline">{event.screen_name}</Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-text-muted">
                                    {new Date(event.timestamp).toLocaleString()}
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    )}
                  </CollapsibleSection>
                </CardContent>
              </Card>

              {/* RIGHT — pretty, full detail for the selected (default: latest) event. */}
              <div className="lg:sticky lg:top-0">
                {selectedEvent ? (
                  <EventDetail event={selectedEvent} />
                ) : (
                  <Card>
                    <CardContent>
                      <p className="text-text-muted">Select an event to see its details.</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The right-hand panel: every field of one event, grouped and pretty-printed. */
function EventDetail({ event }: { event: UserRecentEvent }) {
  const contextEntries = DEVICE_FIELDS.filter(([key]) => event.context[key]).map(
    ([key, label]) => [label, event.context[key]] as [string, unknown],
  );
  const propertyEntries = Object.entries(event.properties);

  return (
    <Card data-testid="event-detail">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-accent/15 px-2 py-0.5 text-sm font-semibold text-accent">
            {event.event}
          </span>
          {event.screen_name && <Badge variant="outline">{event.screen_name}</Badge>}
        </div>
        <p className="mt-1 text-xs text-text-muted">{new Date(event.timestamp).toLocaleString()}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Event
          </h3>
          <PropertyGrid
            entries={[
              ['insert_id', event.insert_id],
              ['event', event.event],
              ['timestamp', new Date(event.timestamp).toLocaleString()],
              ...(event.screen_name ? [['screen_name', event.screen_name] as [string, unknown]] : []),
            ]}
          />
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Properties
          </h3>
          <PropertyGrid entries={propertyEntries} />
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Device &amp; context
          </h3>
          <PropertyGrid entries={contextEntries} />
        </section>
      </CardContent>
    </Card>
  );
}

/**
 * A per-user tap heatmap: pick a captured screen and overlay this ONE user's taps on it. The
 * `distinct_ids` (the profile's §17 identity set: canonical id + aliased anon_ids) is what makes it
 * identity-correct — the backend filters the raw `distinct_id` column to that set, so taps recorded
 * both before and after the person logged in are counted.
 */
function UserTapHeatmap({
  projectId,
  distinctIds,
}: {
  projectId: string;
  distinctIds: string[];
}) {
  const screens = useScreens(projectId);
  const runHeatmap = useRunClickHeatmap(projectId);
  const [selectedScreen, setSelectedScreen] = useState('');
  const [result, setResult] = useState<ClickHeatmapResponse | null>(null);

  const screenList = screens.data?.screens ?? [];
  const selectedSummary = screenList.find((s) => s.screen_name === selectedScreen);

  const onSelectScreen = (screenName: string) => {
    setSelectedScreen(screenName);
    setResult(null);
    if (!screenName) return;
    runHeatmap.mutate(
      {
        screen_name: screenName,
        date_range: { from: defaultDate(30), to: defaultDate(0) },
        grid: HEATMAP_GRID,
        filters: [],
        // §17: scope the heatmap to this user's whole identity set (anon + identified ids).
        distinct_ids: distinctIds,
      },
      { onSuccess: setResult },
    );
  };

  const maxCount = useMemo(
    () => (result ? result.cells.reduce((max, cell) => Math.max(max, cell.count), 0) : 0),
    [result],
  );
  const hasTaps = result !== null && result.total > 0 && result.cells.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="user-heatmap-screen" className="mb-1 block text-sm font-medium">
          Screen
        </label>
        <select
          id="user-heatmap-screen"
          value={selectedScreen}
          onChange={(e) => onSelectScreen(e.target.value)}
          className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="">Select a screen…</option>
          {screenList.map((screen) => (
            <option key={screen.screen_name} value={screen.screen_name}>
              {screen.screen_name}
            </option>
          ))}
        </select>
        {screens.isSuccess && screenList.length === 0 && (
          <p className="mt-2 text-sm text-text-muted">No screens captured yet.</p>
        )}
      </div>

      {runHeatmap.isError && (
        <p role="alert" className="text-danger">
          {runHeatmap.error instanceof ApiError
            ? runHeatmap.error.problem.title
            : 'Failed to load the heatmap'}
        </p>
      )}

      {selectedScreen && result && !hasTaps && (
        <p className="text-text-muted">No taps recorded for this screen in the selected range.</p>
      )}

      {selectedScreen && result && (
        <div className="flex flex-col gap-4">
          <HeatmapLegend total={result.total} maxCount={maxCount} />
          <HeatmapCanvas
            projectId={projectId}
            screenName={selectedScreen}
            summary={selectedSummary}
            result={result}
            grid={HEATMAP_GRID}
            maxCount={maxCount}
            opacity={0.85}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The full interactive per-user path map. `distinct_ids` (the profile's §17 identity set: canonical
 * id + aliased anon_ids) is passed to `useRunScreenPaths`, so the backend restricts the screen-paths
 * query to `distinct_id IN (…)` for this one person — identity-correct across pre- and post-login
 * events, mirroring the tap-heatmap pattern above. Runs once, as soon as the identity set is known.
 */
function UserPathMap({ projectId, distinctIds }: { projectId: string; distinctIds: string[] }) {
  const screens = useScreens(projectId);
  const runScreenPaths = useRunScreenPaths(projectId);
  const [result, setResult] = useState<ScreenPathsResponse | null>(null);

  // screen_name → latest image_hash, so each map node's screenshot is content-addressed (retake-safe).
  const screenHashes = useMemo(
    () => new Map(screens.data?.screens.map((s) => [s.screen_name, s.latest_image_hash]) ?? []),
    [screens.data],
  );

  useEffect(() => {
    if (distinctIds.length === 0) return;
    // Clear the prior user's map first so navigating profile→profile doesn't flash a stale path.
    setResult(null);
    runScreenPaths.mutate(
      {
        direction: 'forward',
        date_range: { from: defaultDate(90), to: defaultDate(0) },
        steps: 3,
        max_nodes_per_step: 6,
        unit: 'user',
        // §17: identity-correct — restrict the path map to this user's whole identity set.
        distinct_ids: distinctIds,
      },
      { onSuccess: setResult },
    );
    // Only re-run when the identity set itself changes (e.g. navigating to another user's profile).
    // `runScreenPaths` (a `useMutation` result) is a fresh object each render, so it is intentionally
    // omitted from the dependency list — including it would refire the request every render.
  }, [projectId, distinctIds.join(',')]);

  if (runScreenPaths.isPending && !result) {
    return <p role="status">Loading path map…</p>;
  }

  if (runScreenPaths.isError) {
    return (
      <p role="alert" className="text-danger">
        {runScreenPaths.error instanceof ApiError
          ? runScreenPaths.error.problem.title
          : 'Failed to load the path map'}
      </p>
    );
  }

  if (!result || result.nodes.length === 0) {
    return <p className="text-text-muted">No screen-path data for this user yet.</p>;
  }

  return (
    <PathMap projectId={projectId} nodes={result.nodes} links={result.links} screenHashes={screenHashes} />
  );
}
