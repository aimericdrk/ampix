import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Favorites & Recents (feat-13 §3): a shared entity reference — `FavItem` — favorited/recently
 * viewed reports, dashboards, users, and cohorts, stored per project in `localStorage` so a star
 * survives reloads and shows up on Home and in the command palette.
 */

export type FavItemType = 'report' | 'dashboard' | 'user' | 'cohort';

export interface FavItem {
  type: FavItemType;
  id: string;
  name: string;
}

export interface UseFavoritesResult {
  list: FavItem[];
  isFavorite: (type: FavItemType, id: string) => boolean;
  toggle: (item: FavItem) => void;
}

const FAV_ITEM_TYPES: ReadonlySet<string> = new Set<FavItemType>([
  'report',
  'dashboard',
  'user',
  'cohort',
]);

function storageKey(projectId: string): string {
  return `myampix:favorites:${projectId}`;
}

function isValidFavItem(value: unknown): value is FavItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== 'string' || !FAV_ITEM_TYPES.has(candidate.type)) return false;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return false;
  return true;
}

/** Guarded parse: an absent key, unparseable JSON, a non-array payload, or malformed entries all
 * fall back to an empty list rather than ever throwing — localStorage being unavailable/corrupt
 * (private mode, quota, hand-edited value) must never break rendering. */
function readStoredFavorites(projectId: string): FavItem[] {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidFavItem);
  } catch {
    return [];
  }
}

function persistFavorites(projectId: string, favorites: FavItem[]): void {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(favorites));
  } catch {
    // Best-effort persistence only — an unavailable localStorage must never break the UI.
  }
}

/**
 * Provides the project-scoped favorites set, mirroring `useAnnotations`'s per-project localStorage
 * pattern: reads on mount (and whenever `projectId` changes), writes back only on explicit `toggle`
 * calls, so simply loading a project never rewrites another project's saved favorites.
 */
export function useFavorites(projectId: string): UseFavoritesResult {
  const [list, setList] = useState<FavItem[]>(() => readStoredFavorites(projectId));
  const mountedProjectId = useRef(projectId);

  useEffect(() => {
    if (mountedProjectId.current === projectId) return;
    mountedProjectId.current = projectId;
    setList(readStoredFavorites(projectId));
  }, [projectId]);

  const toggle = useCallback(
    (item: FavItem) => {
      setList((current) => {
        const exists = current.some((f) => f.type === item.type && f.id === item.id);
        const next = exists
          ? current.filter((f) => !(f.type === item.type && f.id === item.id))
          : [...current, item];
        persistFavorites(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  const isFavorite = useCallback(
    (type: FavItemType, id: string) => list.some((f) => f.type === type && f.id === id),
    [list],
  );

  return { list, isFavorite, toggle };
}
