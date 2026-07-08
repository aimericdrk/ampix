import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '../../../components/ui/button';
import type { AnalysisResult } from '../../../lib/api/types';
import { DashboardGrid, type GridTile } from './DashboardGrid';

/** `null` = "Off" (no polling); otherwise the refetch cadence in ms. */
export type PresentationRefreshInterval = 15000 | 30000 | 60000 | null;

const REFRESH_OPTIONS: { value: string; ms: PresentationRefreshInterval; label: string }[] = [
  { value: '15000', ms: 15000, label: '15s' },
  { value: '30000', ms: 30000, label: '30s' },
  { value: '60000', ms: 60000, label: '60s' },
  { value: 'off', ms: null, label: 'Off' },
];

const DEFAULT_REFRESH_MS: PresentationRefreshInterval = 30000;
const PRESENTATION_ROW_HEIGHT_PX = 220;

function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

export interface PresentationModeProps {
  dashboardName: string;
  tiles: GridTile[];
  results: Map<string, AnalysisResult | { error: string }>;
  loading: boolean;
  /** Re-fetches the dashboard's tile data; called on manual Refresh and on the chosen interval. */
  onRefresh: () => void;
  onClose: () => void;
  /** The Present button — refocused when the overlay closes (mount/unmount only). */
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Fullscreen, chrome-free "TV mode" overlay for a dashboard (feat-16). Mirrors the fullscreen
 * pattern already shipped for the Paths map (`fixed inset-0 z-50`, labelled dialog, Esc to close,
 * focus management, body-scroll lock) and reuses `DashboardGrid` in `readOnly` mode for the tiles
 * themselves — this file only adds the header strip (clock, "Updated" stamp, refresh controls)
 * and the auto-refresh timer.
 */
export function PresentationMode({
  dashboardName,
  tiles,
  results,
  loading,
  onRefresh,
  onClose,
  restoreFocusRef,
}: PresentationModeProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshMs, setRefreshMs] = useState<PresentationRefreshInterval>(DEFAULT_REFRESH_MS);

  // Focus the Exit button on open, close on Esc, lock body scroll while presenting, and restore
  // focus to the Present button on close — mirrors PathsPage's fullscreen map overlay.
  useEffect(() => {
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
    // Mount/unmount only — `onClose`/`restoreFocusRef` are stable for the overlay's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live clock (`aria-hidden`, decorative): only starts ticking from an effect — never in render —
  // so the component still renders deterministically the instant it mounts in a test, with no
  // timer running until after the first commit.
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // The "Updated" stamp reflects an actual refetch (initial mount, manual Refresh, or an
  // interval tick) — never an incidental re-render.
  useEffect(() => {
    setUpdatedAt(new Date());
  }, []);

  // Keep the latest `onRefresh` in a ref so the interval effect below never needs to restart
  // (and re-schedule) just because the caller passed a new function identity.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const handleRefresh = () => {
    onRefreshRef.current();
    setUpdatedAt(new Date());
  };

  useEffect(() => {
    if (!refreshMs) return; // Off — no polling.
    const id = window.setInterval(() => {
      onRefreshRef.current();
      setUpdatedAt(new Date());
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${dashboardName} presentation`}
      className="fixed inset-0 z-50 flex flex-col gap-4 overflow-auto bg-bg p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-semibold">{dashboardName}</h1>
          <span aria-hidden="true" className="font-mono text-xl tabular-nums text-text-muted">
            {now ? formatClock(now) : ''}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-text-muted">
            {updatedAt ? `Updated ${formatClock(updatedAt)}` : ''}
          </span>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-text-muted">Refresh</span>
            <select
              aria-label="Refresh interval"
              value={refreshMs === null ? 'off' : String(refreshMs)}
              onChange={(e) => {
                const option = REFRESH_OPTIONS.find((o) => o.value === e.target.value);
                setRefreshMs(option ? option.ms : null);
              }}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
            >
              {REFRESH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={handleRefresh}>
            Refresh
          </Button>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Exit presentation"
            onClick={onClose}
          >
            Exit
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {tiles.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-text-muted">
            <p className="text-lg font-medium">No tiles yet</p>
            <p className="text-sm">Add tiles to this dashboard to present them here.</p>
          </div>
        ) : (
          <DashboardGrid
            tiles={tiles}
            results={results}
            loading={loading}
            readOnly
            rowHeightPx={PRESENTATION_ROW_HEIGHT_PX}
          />
        )}
      </div>
    </div>
  );
}
