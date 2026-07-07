import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { CollapsibleSection } from '../../../components/ui/CollapsibleSection';
import { ApiError } from '../../../lib/api/problem';
import type {
  ClickHeatmapResponse,
  HeatmapGrid,
  ScreenPathsResponse,
  UserRecentEvent,
} from '../../../lib/api/types';
import { formatExactNumber } from '../format';
import { useRunClickHeatmap, useRunScreenPaths, useScreens, useUserProfile } from '../api';
import { PageShell } from '../../../components/layout/PageShell';
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

export function UserProfilePage() {
  const { projectId, distinctId } = useParams({
    from: '/private/projects/$projectId/users/$distinctId',
  });
  const { data, isPending, isError, error } = useUserProfile(projectId, distinctId);
  const screenPath = useMemo(
    () => (data ? deriveScreenPath(data.recent_events) : []),
    [data],
  );

  return (
    <PageShell
      projectId={projectId}
      title={distinctId}
      breadcrumbs={[
        { label: 'Users', to: '/projects/$projectId/users', params: { projectId } },
        { label: distinctId },
      ]}
    >
      {isPending && <p role="status">Loading user profile…</p>}
      {isError && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load user profile'}
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-text-muted">First seen</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-semibold">
                  {new Date(data.first_seen).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-text-muted">Last seen</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-semibold">
                  {new Date(data.last_seen).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-text-muted">Event count</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-semibold">{formatExactNumber(data.event_count)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="max-w-lg">
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
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>

          {/* Screen path — a lightweight per-user chain of the screens this person moved through. */}
          <Card className="max-w-lg">
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

          {/*
           * Full interactive per-user path map — identity-correct because `distinct_ids` (the
           * profile's §17 identity set: canonical id + aliased anon_ids) is passed through to
           * `useRunScreenPaths`, so the backend restricts the path query to this one person's
           * events (both pre- and post-login). This is distinct from the lightweight mini-diagram
           * above: that one is a quick chronological summary of THIS session's recent events, while
           * this section runs the full multi-step Sankey path query over a 90-day window.
           */}
          <Card>
            <CardContent>
              <CollapsibleSection title="Path map" defaultOpen>
                <UserPathMap projectId={projectId} distinctIds={data.distinct_ids} />
              </CollapsibleSection>
            </CardContent>
          </Card>

          {/* Activity timeline — a visual vertical timeline of the recent event feed. */}
          <Card className="max-w-lg">
            <CardContent>
              <CollapsibleSection title="Activity timeline" defaultOpen>
                {data.recent_events.length === 0 ? (
                  <p className="text-text-muted">No recent events.</p>
                ) : (
                  <ol className="flex flex-col gap-4 border-l border-border pl-6 text-sm">
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
                )}
              </CollapsibleSection>
            </CardContent>
          </Card>

          {/* Tap heatmap — identity-correct per-user, driven by the §17 identity set. */}
          <Card>
            <CardContent>
              <CollapsibleSection title="Tap heatmap" defaultOpen>
                <UserTapHeatmap projectId={projectId} distinctIds={data.distinct_ids} />
              </CollapsibleSection>
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
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
