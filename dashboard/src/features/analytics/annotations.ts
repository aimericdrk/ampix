import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Chart Annotations / Release Markers (feat-08 §3): dated notes ("v1.4 release", "pricing
 * change", …) stored per project in `localStorage`, rendered as vertical markers on every trend
 * chart. One shared set per project — the same notes show on every trend chart for that project.
 */

export interface Annotation {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  label: string;
  color?: string;
}

export interface AddAnnotationInput {
  date: string;
  label: string;
  color?: string;
}

export interface UpdateAnnotationPatch {
  date?: string;
  label?: string;
  color?: string;
}

export interface UseAnnotationsResult {
  annotations: Annotation[];
  add: (input: AddAnnotationInput) => void;
  remove: (id: string) => void;
  update: (id: string, patch: UpdateAnnotationPatch) => void;
}

function storageKey(projectId: string): string {
  return `myampix:annotations:${projectId}`;
}

/** Slug-cases a label for a deterministic id (`"v1.4 release"` -> `"v1-4-release"`). */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Deterministic id from `date` + `label` (NEVER `Math.random`) — same date+label pair reached
 * twice (e.g. re-adding the same note) gets a dedupe suffix (`-2`, `-3`, …) instead of colliding.
 */
function makeId(date: string, label: string, existingIds: ReadonlySet<string>): string {
  const base = `${date}-${slugify(label)}`;
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

function sortAnnotations(list: Annotation[]): Annotation[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

function isValidAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.date !== 'string') return false;
  if (typeof candidate.label !== 'string') return false;
  if (candidate.color !== undefined && typeof candidate.color !== 'string') return false;
  return true;
}

/** Guarded parse: an absent key, unparseable JSON, a non-array payload, or malformed entries all
 * fall back to an empty list rather than ever throwing — localStorage being unavailable/corrupt
 * (private mode, quota, hand-edited value) must never break rendering. */
function readStoredAnnotations(projectId: string): Annotation[] {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortAnnotations(parsed.filter(isValidAnnotation));
  } catch {
    return [];
  }
}

function persistAnnotations(projectId: string, annotations: Annotation[]): void {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(annotations));
  } catch {
    // Best-effort persistence only — an unavailable localStorage must never break the UI.
  }
}

/**
 * Provides the project-scoped annotation set, mirroring `useDateRange`'s per-project
 * localStorage pattern: reads on mount (and whenever `projectId` changes), writes back only on
 * explicit mutations (`add`/`remove`/`update`), so simply loading a project never rewrites
 * another project's saved notes.
 */
export function useAnnotations(projectId: string): UseAnnotationsResult {
  const [annotations, setAnnotations] = useState<Annotation[]>(() => readStoredAnnotations(projectId));
  const mountedProjectId = useRef(projectId);

  useEffect(() => {
    if (mountedProjectId.current === projectId) return;
    mountedProjectId.current = projectId;
    setAnnotations(readStoredAnnotations(projectId));
  }, [projectId]);

  // Every mutation runs through one functional updater so a burst of synchronous calls (e.g. two
  // `add`s in the same event handler) each see the other's effect, rather than both reading the
  // same stale `annotations` closure — and each writes the resulting list straight to storage.
  const mutate = useCallback(
    (updater: (current: Annotation[]) => Annotation[]) => {
      setAnnotations((current) => {
        const next = sortAnnotations(updater(current));
        persistAnnotations(projectId, next);
        return next;
      });
    },
    [projectId],
  );

  const add = useCallback(
    ({ date, label, color }: AddAnnotationInput) => {
      const trimmedLabel = label.trim();
      // An empty label is rejected outright (feat-08 §4) — never stored, never mutated in.
      if (!date || !trimmedLabel) return;
      mutate((current) => {
        const existingIds = new Set(current.map((a) => a.id));
        const id = makeId(date, trimmedLabel, existingIds);
        const annotation: Annotation = { id, date, label: trimmedLabel };
        if (color !== undefined) annotation.color = color;
        return [...current, annotation];
      });
    },
    [mutate],
  );

  const remove = useCallback(
    (id: string) => {
      mutate((current) => current.filter((a) => a.id !== id));
    },
    [mutate],
  );

  const update = useCallback(
    (id: string, patch: UpdateAnnotationPatch) => {
      mutate((current) =>
        current.map((a) => {
          if (a.id !== id) return a;
          const nextLabel = patch.label !== undefined ? patch.label.trim() : a.label;
          if (!nextLabel) return a; // guard: never patch a label down to empty
          return { ...a, ...patch, label: nextLabel };
        }),
      );
    },
    [mutate],
  );

  return { annotations, add, remove, update };
}
