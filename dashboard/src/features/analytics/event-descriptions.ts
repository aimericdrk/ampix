import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Event Catalog descriptions (feat-15 §3): a free-text "what does this event mean" note per event
 * name, stored per project in `localStorage` so a growing team shares one reference — promotable
 * to a shared backend store later (feat-15 §7); this is a client-only v1, mirroring
 * `useAnnotations`/`useFavorites`'s per-project localStorage pattern.
 */

export type EventDescriptions = Record<string, string>;

export interface UseEventDescriptionsResult {
  /** The full event name -> description map for the current project. */
  all: EventDescriptions;
  get: (event: string) => string;
  set: (event: string, text: string) => void;
}

function storageKey(projectId: string): string {
  return `myampix:eventdescs:${projectId}`;
}

/** Guarded parse: an absent key, unparseable JSON, or a non-object/array payload all fall back to
 * an empty map rather than ever throwing — localStorage being unavailable/corrupt (private mode,
 * quota, hand-edited value) must never break rendering. Non-string values are dropped. */
function readStoredDescriptions(projectId: string): EventDescriptions {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: EventDescriptions = {};
    for (const [event, text] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof text === 'string') result[event] = text;
    }
    return result;
  } catch {
    return {};
  }
}

function persistDescriptions(projectId: string, descriptions: EventDescriptions): void {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(descriptions));
  } catch {
    // Best-effort persistence only — an unavailable localStorage must never break the UI.
  }
}

/**
 * Provides the project-scoped event -> description map: reads on mount (and whenever `projectId`
 * changes), writes back only on explicit `set` calls, so simply loading a project never rewrites
 * another project's saved text. `set` is optimistic — the in-memory map (and hence `get`) reflects
 * the new text immediately, before/regardless of the `localStorage` write outcome.
 */
export function useEventDescriptions(projectId: string): UseEventDescriptionsResult {
  const [all, setAll] = useState<EventDescriptions>(() => readStoredDescriptions(projectId));
  const mountedProjectId = useRef(projectId);

  useEffect(() => {
    if (mountedProjectId.current === projectId) return;
    mountedProjectId.current = projectId;
    setAll(readStoredDescriptions(projectId));
  }, [projectId]);

  const set = useCallback(
    (event: string, text: string) => {
      setAll((current) => {
        const next = { ...current, [event]: text };
        persistDescriptions(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  const get = useCallback((event: string) => all[event] ?? '', [all]);

  return { all, get, set };
}
