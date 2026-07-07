import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { defaultDate } from './components/builder-controls';
import { DateRangePresets, presetIdForRange } from './components/explore-controls';

/**
 * App-wide date-range state, shared by every project-scoped page once they migrate onto it
 * (Phase 2). Made available now: a provider + hook + segmented control, persisted per project in
 * `localStorage` so a user's chosen window (Last 7/30/90 days, or a custom range) survives reloads
 * and project switches independently. Defaults to Last 30 days.
 */

export interface DateRangeState {
  from: string;
  to: string;
  preset: string;
}

export interface DateRangeContextValue extends DateRangeState {
  setRange: (from: string, to: string, preset: string) => void;
}

const DateRangeContext = createContext<DateRangeContextValue | undefined>(undefined);

function storageKey(projectId: string): string {
  return `myampix:daterange:${projectId}`;
}

function defaultRange(): DateRangeState {
  return { from: defaultDate(30), to: defaultDate(0), preset: '30' };
}

function readStoredRange(projectId: string): DateRangeState {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return defaultRange();
    const parsed = JSON.parse(raw) as Partial<DateRangeState>;
    if (
      typeof parsed.from === 'string' &&
      typeof parsed.to === 'string' &&
      typeof parsed.preset === 'string'
    ) {
      return { from: parsed.from, to: parsed.to, preset: parsed.preset };
    }
    return defaultRange();
  } catch {
    // Best-effort only — an unavailable localStorage (private mode, quota) must never break
    // rendering; fall back to the default range.
    return defaultRange();
  }
}

/**
 * Provides `useDateRange()` to its subtree, scoped to `projectId`. Reads the persisted range for
 * that project on mount (and whenever `projectId` changes); writes back only on explicit
 * `setRange` calls (e.g. picking a preset), so simply loading a project never overwrites another
 * project's saved range.
 */
export function DateRangeProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [range, setRangeState] = useState<DateRangeState>(() => readStoredRange(projectId));
  const mountedProjectId = useRef(projectId);

  // Re-read persisted state when the project actually changes (e.g. switching projects without
  // unmounting AppLayout). Skip the redundant re-read on first mount — the lazy `useState`
  // initializer above already covers it.
  useEffect(() => {
    if (mountedProjectId.current === projectId) return;
    mountedProjectId.current = projectId;
    setRangeState(readStoredRange(projectId));
  }, [projectId]);

  const setRange = useCallback(
    (from: string, to: string, preset: string) => {
      const next: DateRangeState = { from, to, preset };
      setRangeState(next);
      try {
        window.localStorage.setItem(storageKey(projectId), JSON.stringify(next));
      } catch {
        // Best-effort persistence only.
      }
    },
    [projectId],
  );

  const value = useMemo<DateRangeContextValue>(() => ({ ...range, setRange }), [range, setRange]);

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

export function useDateRange(): DateRangeContextValue {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error('useDateRange must be used within a DateRangeProvider');
  return ctx;
}

/**
 * The segmented "Last 7 · 30 · 90 days · Custom" control, bound to the global date-range context.
 * Wraps the shared `DateRangePresets` primitive so it stays visually and behaviourally identical
 * to the per-page builder controls.
 */
export function DateRangeControl({ className }: { className?: string }) {
  const { from, to, setRange } = useDateRange();

  return (
    <div className={className}>
      <DateRangePresets
        idPrefix="global-date-range"
        from={from}
        to={to}
        onChange={(nextFrom, nextTo) =>
          setRange(nextFrom, nextTo, presetIdForRange(nextFrom, nextTo))
        }
      />
    </div>
  );
}
