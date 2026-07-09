import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { CollapsibleSection } from '../../../components/ui/CollapsibleSection';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import { ApiError } from '../../../lib/api/problem';
import type {
  ClickHeatmapResponse,
  HeatmapGrid,
  ScreenPathsResponse,
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

/**
 * The per-user profile shown as a modal (feat: user info in a popup instead of a dedicated page).
 * Layout: the Activity timeline is the centre column — the hero — with everything else split onto
 * the two flanking columns: identity + profile properties + screen path on the left, the full path
 * map + tap heatmap on the right. Opened from the Users list (and from deep-links / favorites, which
 * still resolve to `/users/$distinctId`).
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

  // Record this profile visit in Recents (feat-13 §3) as soon as it's opened — keyed on `distinctId`
  // so opening the same user twice records it once per open.
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
            <span
              aria-hidden
              className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-accent/15 text-sm font-semibold text-accent"
            >
              {monogram(distinctId)}
            </span>
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
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)]">
              {/* LEFT — identity: profile properties + screen path. */}
              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Profile properties</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {Object.keys(data.profile).length === 0 ? (
                      <p className="text-text-muted">No profile properties.</p>
                    ) : (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                        {Object.entries(data.profile).map(([key, value]) => (
                          <div key={key} className="contents">
                            <dt className="font-medium text-text-muted">{key}</dt>
                            <dd className="truncate text-right">{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <CollapsibleSection title="Screen path" defaultOpen>
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
                              <span className="rounded-full border border-border bg-chart-surface px-2.5 py-1 font-medium">
                                {name}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </CollapsibleSection>
                  </CardContent>
                </Card>
              </div>

              {/* CENTRE — the hero: activity timeline. */}
              <Card className="border-accent/30 lg:sticky lg:top-0">
                <CardContent>
                  <CollapsibleSection title="Activity timeline" defaultOpen>
                    {data.recent_events.length === 0 ? (
                      <p className="text-text-muted">No recent events.</p>
                    ) : (
                      <div
                        className="max-h-[60vh] overflow-y-auto pr-2"
                        data-testid="activity-timeline-scroll"
                      >
                        <ol className="flex flex-col gap-3 border-l border-border pl-6 text-sm">
                          {data.recent_events.map((event) => (
                            <li key={event.insert_id} className="relative">
                              <span
                                aria-hidden
                                className="absolute -left-[1.6875rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent"
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{event.event}</span>
                                {event.screen_name && (
                                  <span className="rounded-full border border-border bg-chart-surface px-2 py-0.5 text-xs text-text-muted">
                                    {event.screen_name}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-text-muted">
                                {new Date(event.timestamp).toLocaleString()}
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </CollapsibleSection>
                </CardContent>
              </Card>

              {/* RIGHT — behaviour: path map + tap heatmap. */}
              <div className="flex flex-col gap-4">
                <Card>
                  <CardContent>
                    <CollapsibleSection title="Path map" defaultOpen>
                      <UserPathMap projectId={projectId} distinctIds={data.distinct_ids} />
                    </CollapsibleSection>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <CollapsibleSection title="Tap heatmap" defaultOpen>
                      <UserTapHeatmap projectId={projectId} distinctIds={data.distinct_ids} />
                    </CollapsibleSection>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
