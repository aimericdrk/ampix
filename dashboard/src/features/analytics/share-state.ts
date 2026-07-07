import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';

/**
 * Shareable Analysis URLs (feat-01) — a generic codec + hook that lets any analysis page (Insights,
 * Funnels, Retention, Flows, Paths) encode its builder state into a single `?s=` search param, so
 * copying the address bar (or a "Copy link" button) reproduces the exact view. No backend, no
 * persistence — the URL *is* the saved state. See
 * `docs/superpowers/specs/2026-07-07-feat-01-shareable-analysis-urls.md`.
 *
 * Each page owns its own `PageAnalysisState` shape (e.g. `InsightsAnalysisState`); this module only
 * knows how to (de)serialize + base64url-encode *some* object that carries the `{ v: 1 }` version
 * envelope below. Field-by-field validation (dropping unknown/invalid fields, clamping array
 * lengths to the builder's limits, coping with a stale segment id) is deliberately the caller's
 * job — this codec only guarantees the envelope is a plausible, versioned JSON object.
 */

/** Every page's analysis state carries at least a version envelope, for forward-compatible decoding. */
export interface AnalysisStateEnvelope {
  v: 1;
}

/** Debounce window for `pushState`, so rapid builder edits coalesce into one URL write. */
const PUSH_DEBOUNCE_MS = 300;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encodes any versioned analysis state as a compact, URL-safe base64 string: no `+`/`/`/`=`, so it
 * drops straight into a search param with no extra escaping.
 */
export function encodeAnalysisState<T extends AnalysisStateEnvelope>(state: T): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(state)));
}

/**
 * Decodes an `s` param back into a partial analysis state. NEVER throws: an absent, blank,
 * malformed, or wrong-version param returns `null` so the caller falls back to defaults (a bad
 * link never surfaces an error — it just loads the default view, and the next edit rewrites a
 * valid `s`). Callers still must validate individual fields — this only checks that the decoded
 * value is a plausible, `{ v: 1 }`-versioned JSON object.
 */
export function decodeAnalysisState<T extends AnalysisStateEnvelope>(
  raw: string | undefined,
): Partial<T> | null {
  if (!raw || raw.trim() === '') return null;
  try {
    const json = new TextDecoder().decode(fromBase64Url(raw));
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if ((parsed as { v?: unknown }).v !== 1) return null;
    return parsed as Partial<T>;
  } catch {
    return null;
  }
}

export interface UrlAnalysisState<T extends AnalysisStateEnvelope> {
  /**
   * The decoded `s` param merged over `defaults`, or `defaults` itself when the param is absent or
   * malformed. Only changes identity when the underlying `s` param actually changes (initial
   * mount, or a back/forward navigation) — never on every render — so a hydration effect keyed on
   * it fires exactly when it should.
   */
  urlState: T;
  /**
   * Re-encodes `next` and writes it to the current route's `s` search param, debounced (~300ms —
   * rapid edits coalesce into one write) and via `replace: true` so builder edits update the
   * current history entry instead of spamming back/forward. Other search params (e.g. an auth
   * `redirect`) are preserved untouched.
   */
  pushState: (next: T) => void;
}

/**
 * Reads the `s` param for whichever route is currently matched (route-agnostic on purpose — every
 * analysis page can reuse this hook as-is) and keeps it in sync with in-memory builder state.
 */
export function useUrlAnalysisState<T extends AnalysisStateEnvelope>(
  defaults: T,
): UrlAnalysisState<T> {
  const search = useSearch({ strict: false }) as { s?: string };
  const navigate = useNavigate();
  const timerRef = useRef<number | undefined>(undefined);

  const urlState = useMemo<T>(() => {
    const decoded = decodeAnalysisState<T>(search.s);
    return decoded ? { ...defaults, ...decoded } : defaults;
  }, [search.s, defaults]);

  useEffect(() => {
    return () => window.clearTimeout(timerRef.current);
  }, []);

  const pushState = useCallback(
    (next: T) => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        const encoded = encodeAnalysisState(next);
        void navigate({
          to: '.',
          search: (prev: Record<string, unknown>) => ({ ...prev, s: encoded }),
          replace: true,
        } as unknown as Parameters<typeof navigate>[0]);
      }, PUSH_DEBOUNCE_MS);
    },
    [navigate],
  );

  return { urlState, pushState };
}
