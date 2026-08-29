import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeFavItem } from './favorites';
import type { FavItem, FavItemType } from './favorites';

/**
 * Recently-viewed entities (feat-13 §3): the last ~15 reports/dashboards/users/cohorts visited,
 * most-recent first, stored per project in `localStorage`. Mirrors `useFavorites`'s guarded
 * read/persist pattern — corrupt or absent storage falls back to an empty list.
 */

export interface UseRecentsResult {
  list: FavItem[];
  record: (item: FavItem) => void;
}

/** Caps the recents list so it stays a quick-access shortlist rather than an unbounded history. */
export const RECENTS_CAP = 15;

const FAV_ITEM_TYPES: ReadonlySet<string> = new Set<FavItemType>([
  'report',
  'dashboard',
  'user',
  'cohort',
]);

function storageKey(projectId: string): string {
  return `myampix:recents:${projectId}`;
}

function isValidFavItem(value: unknown): value is FavItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== 'string' || !FAV_ITEM_TYPES.has(candidate.type)) return false;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return false;
  return true;
}

function readStoredRecents(projectId: string): FavItem[] {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidFavItem).map(sanitizeFavItem);
  } catch {
    return [];
  }
}

function persistRecents(projectId: string, recents: FavItem[]): void {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(recents));
  } catch {
    // Best-effort persistence only — an unavailable localStorage must never break the UI.
  }
}

/**
 * Provides the project-scoped recents list. `record` unshifts the item, dedupes any existing
 * entry for the same `type`+`id` (so revisiting moves it to the top instead of duplicating it,
 * and picks up a renamed entity's latest `name`), and caps the list at `RECENTS_CAP`.
 */
export function useRecents(projectId: string): UseRecentsResult {
  const [list, setList] = useState<FavItem[]>(() => readStoredRecents(projectId));
  const mountedProjectId = useRef(projectId);

  useEffect(() => {
    if (mountedProjectId.current === projectId) return;
    mountedProjectId.current = projectId;
    setList(readStoredRecents(projectId));
  }, [projectId]);

  const record = useCallback(
    (item: FavItem) => {
      setList((current) => {
        const deduped = current.filter((f) => !(f.type === item.type && f.id === item.id));
        const next = [item, ...deduped].slice(0, RECENTS_CAP);
        persistRecents(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  return { list, record };
}
