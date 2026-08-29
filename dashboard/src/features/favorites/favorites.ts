import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Favorites & Recents (feat-13 §3): a shared entity reference — `FavItem` — favorited/recently
 * viewed reports, dashboards, users, and cohorts, stored per project in `localStorage` so a star
 * survives reloads and shows up on Home and in the command palette.
 */

export type FavItemType = 'report' | 'dashboard' | 'user' | 'cohort';

/**
 * The identity details Home shows beneath a starred/recently-viewed PERSON (`type: 'user'`), so the
 * list reads as "Ada Lovelace · 36 · Paris · ada@example.com" rather than a bare distinct id.
 *
 * They are denormalised into storage alongside `name` — captured when the profile is opened — for
 * the same reason `name` already is: Home renders these lists straight from localStorage and must
 * not fan out a profile request per row. The trade-off is staleness; a visit refreshes the entry.
 * Every field is optional because a profile may carry none of them, and because entries starred
 * before this existed are still valid and simply render as name alone.
 */
export interface FavUserDetail {
  age?: string;
  city?: string;
  /** Email, else phone number, else the distinct id — see `contactLine` in `user-identity.ts`. */
  contact?: string;
}

export interface FavItem {
  type: FavItemType;
  id: string;
  name: string;
  /** Only ever set for `type: 'user'`. */
  detail?: FavUserDetail;
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

/**
 * Drops anything non-string out of a stored `detail` (hand-edited storage, an older shape) so the
 * UI only ever renders strings. A wholly invalid `detail` yields `undefined`, never a thrown error
 * — the entry itself stays usable.
 */
export function sanitizeFavItem(item: FavItem): FavItem {
  const raw: unknown = item.detail;
  if (!raw || typeof raw !== 'object') return item.detail ? { ...item, detail: undefined } : item;
  const source = raw as Record<string, unknown>;
  const detail: FavUserDetail = {};
  for (const key of ['age', 'city', 'contact'] as const) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) detail[key] = value;
  }
  return { ...item, detail: Object.keys(detail).length > 0 ? detail : undefined };
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
    return parsed.filter(isValidFavItem).map(sanitizeFavItem);
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
