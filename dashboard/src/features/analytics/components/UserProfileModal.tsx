import { Fragment, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { useEffect } from 'react';
import { Avatar, AvatarFallback } from '../../../components/ui/avatar';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { CollapsibleSection } from '../../../components/ui/CollapsibleSection';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import { fieldLook } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { cn } from '../../../lib/cn';
import { ApiError } from '../../../lib/api/problem';
import type {
  ClickHeatmapResponse,
  HeatmapGrid,
  ScreenPathsResponse,
  UserEventContext,
  UserRecentEvent,
  UserSubscription,
} from '../../../lib/api/types';
import { formatCurrency, formatExactNumber } from '../format';
import {
  useRunClickHeatmap,
  useRunScreenPaths,
  useScreens,
  useUserEvents,
  useUserProfile,
} from '../api';
import { FavoriteButton } from '../../favorites/FavoriteButton';
import { useFavorites } from '../../favorites/favorites';
import { useRecents } from '../../favorites/recents';
import { useRcEnabled, useRefreshUserSubscription, useUserSubscription } from '../../revenuecat/api';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Fingerprint, Maximize2, RotateCw, Route, Waypoints, X } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { defaultDate } from './builder-controls';
import { HeatmapCanvas, HeatmapLegend } from './HeatmapCanvas';
import { PathMap } from './PathMap';

/** The three data-heavy exploration views launched into a larger modal over the profile. */
type ExplorerTab = 'screen-path' | 'path-map' | 'heatmap';
const EXPLORER_LAUNCHERS: Array<{ tab: ExplorerTab; label: string; icon: typeof Route; hint: string }> = [
  { tab: 'screen-path', label: 'Screen path', icon: Route, hint: 'The order of screens this user visited' },
  { tab: 'path-map', label: 'Path map', icon: Waypoints, hint: 'How this user moved between screens' },
  { tab: 'heatmap', label: 'Tap heatmap', icon: Fingerprint, hint: 'Where this user tapped, per screen' },
];

/** The screen-view autocapture event (contracts §4) — drives the per-user screen-path diagram. */
const SCREEN_VIEW_EVENT = '$screen_view';
/** RevenueCat timeline event prefix (spec §4.7) — `$rc_initial_purchase`, `$rc_renewal`, etc. */
const RC_EVENT_PREFIX = '$rc_';

/**
 * App-lifecycle autocapture (contracts §4). The raw names are accurate but read like plumbing in a
 * timeline; these are the same facts in the words someone reading a user's activity wants: when
 * they left the app and when they came back.
 */
const LIFECYCLE_LABELS: Record<string, string> = {
  $app_open: 'Opened the app',
  $app_background: 'Left the app',
  $session_start: 'Session started',
  $session_end: 'Session ended',
  $first_open: 'First ever open',
};

/** `1h 04m` / `4m 12s` / `18s` — a gap between two events, at the coarsest useful precision. */
function formatGap(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/**
 * Where the app was closed and reopened, read off `session_id` rather than off `$app_open` events.
 * The SDK rotates the session id once the app has been backgrounded past its timeout (30 min by
 * default), so a change between two adjacent events IS a quit-and-return — and it still shows up
 * for users whose lifecycle autocapture never fired, or whose `$app_open` was lost in an
 * uninstalled queue.
 *
 * `events` is newest-first, so `events[i]` starting a different session than `events[i - 1]` means
 * the boundary sits between them: the older event ended the previous visit, the newer one began
 * the next. An empty session id (events ingested before the SDK carried one) is "unknown", never a
 * boundary — inventing a reopen out of missing data would be worse than showing none.
 */
/**
 * The SDK's default `sessionTimeout`: 30 minutes backgrounded before the session id rotates. A gap
 * at least this long is worth breaking the timeline over even when the session id did NOT change —
 * an app left open and untouched overnight is the same "they were gone" the reader is looking for,
 * and it is what makes a burst of activity legible as one sitting.
 */
const LONG_PAUSE_MS = 30 * 60 * 1000;

/**
 * Why the timeline should break between `events[index - 1]` (newer) and `events[index]` (older),
 * or null for no break. `events` is newest-first, so the gap runs from the older row up to the
 * newer one.
 *
 * `session` is the stronger signal: the SDK rotates the session id when the app comes back from
 * the background, so it is a real quit-and-return even if the clock gap is short. It is read off
 * the id rather than off `$app_open`, so it still shows for users whose lifecycle autocapture
 * never fired. An empty session id (server-side events, or events from before the SDK carried
 * one) is "unknown" and never a boundary — inventing a reopen out of missing data is worse than
 * showing none.
 */
function timelineBreakBefore(
  events: UserRecentEvent[],
  index: number,
): { kind: 'session' | 'pause'; awayMs: number; resumedAt: string } | null {
  if (index === 0) return null;
  const older = events[index];
  const newer = events[index - 1];
  if (!older || !newer) return null;

  const awayMs = new Date(newer.timestamp).getTime() - new Date(older.timestamp).getTime();
  const knownSessions = Boolean(older.session_id) && Boolean(newer.session_id);
  if (knownSessions && older.session_id !== newer.session_id) {
    return { kind: 'session', awayMs, resumedAt: newer.timestamp };
  }
  if (awayMs >= LONG_PAUSE_MS) {
    return { kind: 'pause', awayMs, resumedAt: newer.timestamp };
  }
  return null;
}

/**
 * A RevenueCat subscription lifecycle event. `$rc_link` shares the `$rc_` prefix but is an SDK
 * identity event (not a subscription event), so it's excluded from the "subscription" badge/ring.
 */
function isSubscriptionEvent(name: string): boolean {
  return name.startsWith(RC_EVENT_PREFIX) && name !== '$rc_link';
}
const HEATMAP_GRID: HeatmapGrid = { cols: 20, rows: 40 };

/** Subscription status -> Badge variant (spec §4.7). Unlisted statuses fall back to `default`. */
const SUBSCRIPTION_STATUS_VARIANT: Record<
  string,
  'success' | 'info' | 'warning' | 'outline' | 'danger'
> = {
  active: 'success',
  trial: 'info',
  grace: 'warning',
  paused: 'outline',
  churned: 'danger',
};

/**
 * The forward (newest-first) index of the OLDEST `$rc_initial_purchase` in `events`, or -1 if none.
 * `events` is newest-first, so the oldest occurrence is the last match when scanning forward —
 * equivalently the first match when scanning the reversed (oldest-first) array, mapped back.
 */
function firstSubscribedIndex(events: UserRecentEvent[]): number {
  const reversedIdx = [...events].reverse().findIndex((e) => e.event === '$rc_initial_purchase');
  return reversedIdx === -1 ? -1 : events.length - 1 - reversedIdx;
}

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
  // The data-heavy views (screen path, path map, tap heatmap) open in a larger modal on demand —
  // null when that modal is closed. Opening picks the active tab.
  const [explorerTab, setExplorerTab] = useState<ExplorerTab | null>(null);
  // The explorer views are one-shot snapshots fetched when opened; bumping this refetches them in
  // place (path map / heatmap remount, and the profile — which the screen path derives from — is
  // invalidated) so new activity shows without closing and reopening.
  const [explorerRefresh, setExplorerRefresh] = useState(0);
  const queryClient = useQueryClient();
  const refreshExplorer = () => {
    void queryClient.invalidateQueries({ queryKey: ['analytics', projectId, 'user', distinctId] });
    setExplorerRefresh((n) => n + 1);
  };

  // RC subscription card (spec §4.7) — hidden entirely when the project isn't connected to
  // RevenueCat or this user has never had a subscription event.
  const rcEnabled = useRcEnabled(projectId);
  const { data: subscriptionData } = useUserSubscription(projectId, distinctId, rcEnabled);
  const subscription = subscriptionData?.subscription ?? null;
  const refreshSubscription = useRefreshUserSubscription(projectId);
  const { toast } = useToast();
  const handleRefreshSubscription = () => {
    refreshSubscription.mutate(distinctId, {
      onSuccess: () => toast({ title: 'Subscription refreshed' }),
      onError: (err) =>
        toast({
          title: 'Could not refresh subscription',
          description: err instanceof ApiError ? err.problem.title : 'Something went wrong.',
          variant: 'error',
        }),
    });
  };

  // The event whose detail is shown on the right. `null` means "follow the latest" (recent_events
  // is newest-first, so index 0). Clicking a timeline event pins it here.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The timeline pages independently of the profile: page 1 here is the same window
  // `data.recent_events` holds, and every page after it is appended as the list scrolls.
  const eventsQuery = useUserEvents(projectId, distinctId);
  // No fallback to `data.recent_events` on purpose: a failed page would then render as 50 events
  // with nothing more to load, which is indistinguishable from "you have reached the end" — the
  // exact shape of a timeline that looks fine and silently refuses to grow. An error is shown.
  const events = useMemo(
    () => eventsQuery.data?.pages.flatMap((page) => page.events) ?? [],
    [eventsQuery.data],
  );
  const selectedEvent = events.find((e) => e.insert_id === selectedId) ?? events[0];
  const firstSubIndex = useMemo(() => firstSubscribedIndex(events), [events]);

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

  // Infinite scroll for the timeline. The sentinel sits after the last row INSIDE the scroll
  // container, so `root: null` (the viewport) would never intersect — the container is what
  // scrolls, and it is what has to be the root.
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = eventsQuery;
  const [timelineViewport, setTimelineViewport] = useState<HTMLDivElement | null>(null);
  const [loadMoreSentinel, setLoadMoreSentinel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!timelineViewport || !loadMoreSentinel || !hasNextPage || isFetchingNextPage) return;
    // Not universal (and absent in jsdom): without it the button below is the whole story, which
    // is why paging is never left to the observer alone.
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
      },
      // A little early, so the next page is on its way before the user hits the true bottom.
      { root: timelineViewport, rootMargin: '200px' },
    );
    observer.observe(loadMoreSentinel);
    return () => observer.disconnect();
  }, [timelineViewport, loadMoreSentinel, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Record this profile visit in Recents (feat-13 §3) as soon as it's opened — keyed on `distinctId`.
  useEffect(() => {
    recordRecent({ type: 'user', id: distinctId, name: distinctId });
  }, [distinctId, recordRecent]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[98vh] w-[96vw] max-w-7xl flex-col gap-0 overflow-hidden p-0"
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
                viewBox="0 0 20 20"
                className="h-6 w-6"
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

                {rcEnabled && subscription && (
                  <Card>
                    <CardContent>
                      <CollapsibleSection title="Subscription" defaultOpen>
                        <SubscriptionCard
                          subscription={subscription}
                          isRefreshing={refreshSubscription.isPending}
                          onRefresh={handleRefreshSubscription}
                        />
                      </CollapsibleSection>
                    </CardContent>
                  </Card>
                )}

                {/* These three views carry a lot of data, so they open in a larger modal on top
                    of the profile rather than cramping the left column. */}
                <Card>
                  <CardHeader>
                    <CardTitle>Journey &amp; interactions</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {EXPLORER_LAUNCHERS.map(({ tab, label, icon: Icon, hint }) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setExplorerTab(tab)}
                        className="group flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{label}</span>
                          <span className="block truncate text-xs text-text-muted">{hint}</span>
                        </span>
                        <Maximize2
                          className="size-4 shrink-0 text-text-muted transition-colors group-hover:text-accent"
                          aria-hidden
                        />
                      </button>
                    ))}
                  </CardContent>
                </Card>

                <Dialog
                  open={explorerTab !== null}
                  onOpenChange={(open) => !open && setExplorerTab(null)}
                >
                  <DialogContent className="flex h-[92vh] w-[96vw] max-w-[110rem] flex-col gap-0 overflow-hidden p-0">
                    <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
                      <DialogTitle className="text-base font-semibold">
                        Journey &amp; interactions
                      </DialogTitle>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={refreshExplorer}
                          className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-text-muted transition-colors hover:bg-surface-raised hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          <RotateCw className="size-4" aria-hidden />
                          Refresh
                        </button>
                        <DialogClose
                          aria-label="Close"
                          className="flex size-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          <X className="size-4" aria-hidden />
                        </DialogClose>
                      </div>
                    </header>
                    {explorerTab !== null && (
                      <Tabs
                        value={explorerTab}
                        onValueChange={(value) => setExplorerTab(value as ExplorerTab)}
                        className="flex min-h-0 flex-1 flex-col"
                      >
                        <TabsList className="shrink-0 px-6 pt-4">
                          <TabsTrigger value="screen-path">Screen path</TabsTrigger>
                          <TabsTrigger value="path-map">Path map</TabsTrigger>
                          <TabsTrigger value="heatmap">Tap heatmap</TabsTrigger>
                        </TabsList>
                        <div className="min-h-0 flex-1 overflow-auto p-6">
                          <TabsContent value="screen-path">
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
                                    <Badge
                                      variant="outline"
                                      className="px-2.5 py-1 text-sm font-medium"
                                    >
                                      {name}
                                    </Badge>
                                  </li>
                                ))}
                              </ol>
                            )}
                          </TabsContent>
                          <TabsContent value="path-map">
                            <UserPathMap
                              projectId={projectId}
                              distinctIds={data.distinct_ids}
                              refreshKey={explorerRefresh}
                            />
                          </TabsContent>
                          <TabsContent value="heatmap">
                            <UserTapHeatmap
                              key={explorerRefresh}
                              projectId={projectId}
                              distinctIds={data.distinct_ids}
                            />
                          </TabsContent>
                        </div>
                      </Tabs>
                    )}
                  </DialogContent>
                </Dialog>
              </div>

              {/* CENTRE — the activity timeline; each event selects itself on click. */}
              <Card className="border-accent/30">
                <CardContent>
                  <CollapsibleSection title="Activity timeline" defaultOpen>
                    {eventsQuery.error ? (
                      <p role="alert" className="text-danger">
                        {eventsQuery.error instanceof ApiError
                          ? eventsQuery.error.problem.title
                          : 'Failed to load events'}
                      </p>
                    ) : events.length === 0 ? (
                      <p className="text-text-muted">
                        {eventsQuery.isPending ? 'Loading events…' : 'No recent events.'}
                      </p>
                    ) : (
                      <div
                        ref={setTimelineViewport}
                        className="max-h-[80vh] overflow-y-auto pl-3 pr-1"
                        data-testid="activity-timeline-scroll"
                      >
                        <ol className="flex flex-col gap-1 border-l border-border pl-4 text-sm">
                          {events.map((event, index) => {
                            const isSelected = event.insert_id === selectedEvent?.insert_id;
                            const isRcEvent = isSubscriptionEvent(event.event);
                            const lifecycleLabel = LIFECYCLE_LABELS[event.event];
                            const timelineBreak = timelineBreakBefore(events, index);
                            return (
                              <Fragment key={event.insert_id}>
                                {index === firstSubIndex && (
                                  <li
                                    role="presentation"
                                    className="-ml-4 pl-4 py-1 text-xs font-semibold text-accent"
                                  >
                                    ★ First subscribed
                                  </li>
                                )}
                                {timelineBreak && (
                                  <li
                                    role="presentation"
                                    className="-ml-4 my-2 flex items-center gap-2 pl-[0.35rem] text-xs text-text-muted"
                                  >
                                    <span
                                      aria-hidden
                                      className="size-2 flex-none rounded-full border border-dashed border-text-muted bg-surface"
                                    />
                                    <span className="whitespace-nowrap">
                                      {timelineBreak.kind === 'session' ? 'App closed' : 'Paused'}{' '}
                                      <span className="font-medium text-text">
                                        {formatGap(timelineBreak.awayMs)}
                                      </span>{' '}
                                      ·{' '}
                                      {timelineBreak.kind === 'session' ? 'reopened' : 'resumed'}{' '}
                                      {new Date(timelineBreak.resumedAt).toLocaleString()}
                                    </span>
                                    {/* The rule is the separation itself: a dashed line across the
                                        list, so one sitting reads as a block at a glance. */}
                                    <span
                                      aria-hidden
                                      className="h-px flex-1 border-t border-dashed border-border"
                                    />
                                  </li>
                                )}
                                <li className="relative">
                                  <span
                                    aria-hidden
                                    className={cn(
                                      'absolute -left-[1.3125rem] top-2.5 h-2.5 w-2.5 rounded-full border-2 border-surface',
                                      isSelected
                                        ? 'bg-accent ring-2 ring-accent/30'
                                        : isRcEvent
                                          ? 'bg-accent ring-2 ring-accent/20'
                                          : 'bg-accent',
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
                                      <span className="font-medium">
                                        {lifecycleLabel ?? event.event}
                                      </span>
                                      {/* The raw name stays visible next to the friendly one —
                                          renaming an event in the UI without showing what it
                                          actually is makes the timeline impossible to match
                                          against a query or a filter. */}
                                      {lifecycleLabel && (
                                        <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[0.7rem] text-text-muted">
                                          {event.event}
                                        </code>
                                      )}
                                      {event.screen_name && (
                                        <Badge variant="outline">{event.screen_name}</Badge>
                                      )}
                                      {isRcEvent && <Badge variant="accent">subscription</Badge>}
                                    </div>
                                    <div className="text-xs text-text-muted">
                                      {new Date(event.timestamp).toLocaleString()}
                                    </div>
                                  </button>
                                </li>
                              </Fragment>
                            );
                          })}
                        </ol>
                        {/* The sentinel the observer watches; the button is the same action for
                            anyone who can't scroll it into view (keyboard, reduced motion, or a
                            browser without IntersectionObserver). */}
                        {hasNextPage && (
                          <div ref={setLoadMoreSentinel} className="pt-3 text-center">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isFetchingNextPage}
                              onClick={() => void fetchNextPage()}
                            >
                              {isFetchingNextPage ? 'Loading…' : 'Load older events'}
                            </Button>
                          </div>
                        )}
                        {!hasNextPage && events.length > 0 && (
                          <p className="pt-3 text-center text-xs text-text-muted">
                            Beginning of this user&apos;s history
                          </p>
                        )}
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

/** The LEFT column's RC subscription summary (spec §4.7): status, plan/store/period, spend, dates,
 *  a manual refresh, and a deep-link into RevenueCat's dashboard when the project id is known. */
function SubscriptionCard({
  subscription,
  isRefreshing,
  onRefresh,
}: {
  subscription: UserSubscription;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const currency = subscription.currency ?? 'USD';
  return (
    <div className="flex flex-col gap-3">
      <Badge variant={SUBSCRIPTION_STATUS_VARIANT[subscription.status] ?? 'default'}>
        {subscription.status}
      </Badge>
      <PropertyGrid
        entries={[
          ['Plan', subscription.product_id],
          ['Store', subscription.store],
          ['Period', subscription.period_type],
          ['Total spent', formatCurrency(subscription.total_spent_cents / 100, currency)],
          ['MRR', formatCurrency(subscription.mrr_cents / 100, currency)],
          [
            'First purchased',
            subscription.first_purchase_at
              ? new Date(subscription.first_purchase_at).toLocaleDateString()
              : null,
          ],
          [
            'Renews / expires',
            subscription.expires_at ? new Date(subscription.expires_at).toLocaleDateString() : null,
          ],
        ]}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" disabled={isRefreshing} onClick={onRefresh}>
          {isRefreshing ? 'Refreshing…' : 'Refresh from RevenueCat'}
        </Button>
        {subscription.rc_customer_url && (
          <a
            href={subscription.rc_customer_url}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-accent hover:underline"
          >
            Open in RevenueCat
          </a>
        )}
      </div>
    </div>
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
          className={cn(fieldLook, 'w-auto')}
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

/** How the path map is anchored: from each visit's entry, or pinned to a chosen start/end screen. */
type PathAnchorMode = 'entry' | 'start' | 'end';
const PATH_STEP_OPTIONS = [1, 2, 3, 4, 5];
const PATH_MAX_NODE_OPTIONS = [3, 6, 10, 20];
const PATH_RANGE_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
];

/** One segment of the path-map control bar: a micro-label + a borderless (ghost) native select with
 *  a custom chevron, so the four controls read as one cohesive toolbar rather than separate boxes. */
function PathControl({
  label,
  id,
  value,
  onChange,
  children,
}: {
  label: string;
  id: string;
  value: string | number;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-wide text-text-muted"
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={onChange}
          className="cursor-pointer appearance-none bg-transparent pr-5 text-sm font-medium text-text focus:outline-none focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-0 top-1/2 size-3.5 -translate-y-1/2 text-text-muted"
        />
      </div>
    </div>
  );
}

/**
 * The full interactive per-user path map. `distinct_ids` (the profile's §17 identity set: canonical
 * id + aliased anon_ids) restricts the screen-paths query to this one person — identity-correct
 * across pre- and post-login events, mirroring the tap-heatmap pattern above. The controls map to
 * the §19 screen-paths params: anchor mode → `anchor_screen` + `direction` ("starts with" = forward
 * from the screen, "ends with" = backward into it), plus `steps`, `max_nodes_per_step`, and range.
 * `refreshKey` re-runs the current query in place without resetting the controls.
 */
function UserPathMap({
  projectId,
  distinctIds,
  refreshKey,
}: {
  projectId: string;
  distinctIds: string[];
  refreshKey: number;
}) {
  const screens = useScreens(projectId);
  const runScreenPaths = useRunScreenPaths(projectId);
  const [result, setResult] = useState<ScreenPathsResponse | null>(null);

  const [anchorMode, setAnchorMode] = useState<PathAnchorMode>('entry');
  const [anchorScreen, setAnchorScreen] = useState('');
  const [steps, setSteps] = useState(3);
  const [maxNodes, setMaxNodes] = useState(6);
  const [days, setDays] = useState(90);

  const screenList = screens.data?.screens ?? [];
  // screen_name → latest image_hash, so each map node's screenshot is content-addressed (retake-safe).
  const screenHashes = useMemo(
    () => new Map(screenList.map((s) => [s.screen_name, s.latest_image_hash])),
    [screenList],
  );

  // "Starts with"/"Ends with" need a screen picked before the query is meaningful.
  const needsScreen = anchorMode !== 'entry' && anchorScreen === '';

  useEffect(() => {
    if (distinctIds.length === 0 || needsScreen) {
      setResult(null);
      return;
    }
    // Clear first so changing a control (or switching user) doesn't flash the previous result.
    setResult(null);
    runScreenPaths.mutate(
      {
        direction: anchorMode === 'end' ? 'backward' : 'forward',
        date_range: { from: defaultDate(days), to: defaultDate(0) },
        steps,
        max_nodes_per_step: maxNodes,
        unit: 'user',
        // §17: identity-correct — restrict the path map to this user's whole identity set.
        distinct_ids: distinctIds,
        ...(anchorMode !== 'entry' ? { anchor_screen: anchorScreen } : {}),
      },
      { onSuccess: setResult },
    );
    // `runScreenPaths` (a `useMutation` result) is a fresh object each render, so it is intentionally
    // omitted from the dependency list — including it would refire the request every render.
  }, [projectId, distinctIds.join(','), anchorMode, anchorScreen, steps, maxNodes, days, refreshKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex flex-wrap items-stretch divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface">
        <PathControl
          label="Path"
          id="path-anchor-mode"
          value={anchorMode}
          onChange={(e) => setAnchorMode(e.target.value as PathAnchorMode)}
        >
          <option value="entry">From entry screen</option>
          <option value="start">Starts with…</option>
          <option value="end">Ends with…</option>
        </PathControl>

        {anchorMode !== 'entry' && (
          <PathControl
            label="Screen"
            id="path-anchor-screen"
            value={anchorScreen}
            onChange={(e) => setAnchorScreen(e.target.value)}
          >
            <option value="">Select a screen…</option>
            {screenList.map((screen) => (
              <option key={screen.screen_name} value={screen.screen_name}>
                {screen.screen_name}
              </option>
            ))}
          </PathControl>
        )}

        <PathControl
          label="Steps"
          id="path-steps"
          value={steps}
          onChange={(e) => setSteps(Number(e.target.value))}
        >
          {PATH_STEP_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </PathControl>

        <PathControl
          label="Max per step"
          id="path-max-nodes"
          value={maxNodes}
          onChange={(e) => setMaxNodes(Number(e.target.value))}
        >
          {PATH_MAX_NODE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </PathControl>

        <PathControl
          label="Range"
          id="path-range"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {PATH_RANGE_OPTIONS.map((r) => (
            <option key={r.days} value={r.days}>
              {r.label}
            </option>
          ))}
        </PathControl>
      </div>

      {runScreenPaths.isError ? (
        <p role="alert" className="text-danger">
          {runScreenPaths.error instanceof ApiError
            ? runScreenPaths.error.problem.title
            : 'Failed to load the path map'}
        </p>
      ) : needsScreen ? (
        <p className="text-text-muted">Pick a screen to anchor the path.</p>
      ) : runScreenPaths.isPending && !result ? (
        <p role="status">Loading path map…</p>
      ) : !result || result.nodes.length === 0 ? (
        <p className="text-text-muted">No screen-path data for this user in this range.</p>
      ) : (
        <PathMap
          projectId={projectId}
          nodes={result.nodes}
          links={result.links}
          screenHashes={screenHashes}
        />
      )}
    </div>
  );
}
