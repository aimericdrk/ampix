import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Inbox } from 'lucide-react';
import { PageShell } from '../../../components/layout/PageShell';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { cn } from '../../../lib/cn';
import { useReducedMotion } from '../../../lib/motion';
import { ApiError } from '../../../lib/api/problem';
import type { LiveEvent } from '../../../lib/api/types';
import { useLiveEvents } from '../api';
import { StatTile } from './charts/StatTile';

/** How often the relative-time labels ("3s ago") re-render while the stream is live. */
const RELATIVE_TIME_TICK_MS = 1000;

/** `2026-07-02T12:03:00.000Z` at various ages -> "3s ago" / "5m ago" / "2h ago" / "1d ago". */
function formatRelativeTime(timestamp: string, now: number): string {
  const diffMs = Math.max(0, now - new Date(timestamp).getTime());
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Per-minute event counts across the currently-loaded window, oldest -> newest — sparkline
 * fodder for the "events/min" live indicator, not a metric shown on its own. Buckets by truncating
 * the ISO timestamp to the minute, so it needs no date-math beyond string slicing + sorting.
 */
function eventsPerMinuteSeries(events: LiveEvent[]): number[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const bucket = event.timestamp.slice(0, 16); // "2026-07-02T12:03" — truncate ISO to the minute
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return Array.from(counts.keys())
    .sort()
    .map((bucket) => counts.get(bucket)!);
}

/** A small "is this live" dot: pulses (via `animate-ping`) while streaming, sits still when paused
 * or when the visitor prefers reduced motion. */
function LivePulse({ paused }: { paused: boolean }) {
  const reducedMotion = useReducedMotion();
  const pulsing = !paused && !reducedMotion;
  return (
    <span className="relative flex size-2" aria-hidden="true">
      {pulsing && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-75" />
      )}
      <span
        className={cn('relative inline-flex size-2 rounded-full', paused ? 'bg-text-muted' : 'bg-accent')}
      />
    </span>
  );
}

/**
 * The Live page — a real-time event stream (`useLiveEvents` already polls every 5s) plus a few
 * stats derived from the currently-loaded window: recent event count, distinct recent active
 * users, and an events/min sparkline. All three are explicitly labelled "(recent)" so they're
 * never mistaken for all-time totals from a proper aggregation endpoint. A Pause/Resume toggle
 * freezes the displayed list (the query keeps polling underneath) so a user can inspect a moment
 * without rows shifting under the cursor.
 */
export function LiveEventsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/live' });
  const { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useLiveEvents(projectId);

  const liveEvents = useMemo(() => data?.pages.flatMap((page) => page.events) ?? [], [data]);

  const [paused, setPaused] = useState(false);
  // Mirrors `liveEvents` while live; stops updating (freezes) the moment `paused` flips to true,
  // and snaps back to the latest data the moment it flips back.
  const [displayedEvents, setDisplayedEvents] = useState<LiveEvent[]>([]);
  useEffect(() => {
    if (!paused) setDisplayedEvents(liveEvents);
  }, [liveEvents, paused]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), RELATIVE_TIME_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const events = paused ? displayedEvents : liveEvents;
  const activeUsers = useMemo(() => new Set(events.map((e) => e.distinct_id)).size, [events]);
  const perMinuteSeries = useMemo(() => eventsPerMinuteSeries(events), [events]);

  // New-row entrance (feat-18): the stream already keys rows by `insert_id`, so a lightweight
  // `animate-fade-up` class is all a freshly-arrived row needs — no re-keying or reordering. `null`
  // on first render means "just mounted", so the initial page of events doesn't all entrance at
  // once; once committed, `previousIdsRef` tracks what's already been seen so only genuinely new
  // arrivals (the next poll tick) get the class.
  const previousIdsRef = useRef<Set<string> | null>(null);
  const newEventIds = useMemo(() => {
    const seen = previousIdsRef.current;
    if (!seen) return new Set<string>();
    const next = new Set<string>();
    for (const event of events) {
      if (!seen.has(event.insert_id)) next.add(event.insert_id);
    }
    return next;
  }, [events]);
  useEffect(() => {
    previousIdsRef.current = new Set(events.map((event) => event.insert_id));
  }, [events]);

  return (
    <PageShell
      projectId={projectId}
      title="Live"
      description="Real-time event stream and a few live stats — watch events arrive as your app sends them."
      breadcrumbs={[{ label: 'Audience' }, { label: 'Live' }]}
      titleAdornment={<LivePulse paused={paused} />}
      actions={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-pressed={paused}
          onClick={() => setPaused((prev) => !prev)}
        >
          {paused ? 'Resume' : 'Pause'}
        </Button>
      }
    >
      {isPending && (
        <Reveal index={0}>
          <p role="status">Loading live events…</p>
        </Reveal>
      )}
      {isError && (
        <Reveal index={0}>
          <p role="alert" className="text-danger">
            {error instanceof ApiError ? error.problem.title : 'Failed to load live events'}
          </p>
        </Reveal>
      )}

      {!isPending && !isError && (
        <Reveal index={1} className="flex flex-col gap-6">
          <SectionGrid>
            <StatTile
              label="Events (recent)"
              value={events.length}
              hint="Count in the currently-loaded window, not all-time"
            />
            <StatTile
              label="Active users (recent)"
              value={activeUsers}
              hint="Distinct users in the currently-loaded window"
            />
            <StatTile
              label="Events/min (recent)"
              value={perMinuteSeries.at(-1) ?? 0}
              spark={perMinuteSeries.length >= 2 ? perMinuteSeries : undefined}
              hint="Per-minute rate across the currently-loaded window"
            />
          </SectionGrid>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>Event stream</CardTitle>
              {paused && (
                <span className="text-xs text-text-muted">Paused — new events are held back</span>
              )}
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <EmptyState icon={Inbox} title="Waiting for events…" />
              ) : (
                <ol
                  role="log"
                  aria-live="polite"
                  aria-label="Live event stream, newest first"
                  className="flex flex-col divide-y divide-border"
                >
                  {events.map((event) => (
                    <li
                      key={event.insert_id}
                      className={cn(
                        'flex flex-wrap items-center justify-between gap-2 py-2 text-sm',
                        newEventIds.has(event.insert_id) && 'animate-fade-up',
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Badge variant="accent">{event.event}</Badge>
                        {event.event.startsWith('$rc_') && (
                          <Badge variant="accent">subscription</Badge>
                        )}
                        <span
                          className="truncate font-mono text-xs text-text-muted"
                          title={event.distinct_id}
                        >
                          {event.distinct_id}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-text-muted">
                        <span>{event.os}</span>
                        <span>{event.app_version}</span>
                        <span>{formatRelativeTime(event.timestamp, now)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {hasNextPage && (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => void fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? 'Loading…' : 'Load older'}
                </Button>
              )}
            </CardContent>
          </Card>
        </Reveal>
      )}
    </PageShell>
  );
}
