# Feature 01 — Shareable Analysis URLs

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend only, no backend)

## 1. What it is
Every analysis view (Insights, Funnels, Retention, Flows, Paths) becomes a **link**. The full builder
state — chosen events, aggregation, filters, breakdown, segment, date range, chart type — is encoded
in the URL, so copying the address bar (or clicking a **Copy link** button) reproduces the exact view
for a teammate, a bookmark, or a Slack message. Opening such a link hydrates the builder to that state
and auto-runs it. No backend, no persistence — the URL *is* the saved state.

## 2. Why it's worth doing well
- Analyses are currently ephemeral: refresh or navigate away and the builder resets. That's the single
  biggest "I lost my work" friction.
- It's the zero-backend half of "sharing": no auth surface, no storage, works instantly.
- It composes with later features (Global filters, Segment comparison, Favorites, Add-to-dashboard all
  read/write the same serialized state).

## 3. Design

### 3.1 Encoding — a single compact `?s=` param
Rather than a sprawl of typed search params, encode the builder state as ONE URL-safe param:
`?s=<base64url(JSON.stringify(state))>`. Rationale: filters are nested/variable-length; one param keeps
routes simple and avoids TanStack `validateSearch` churn across 5 routes. Keep the JSON compact (short
keys). Provide a versioned envelope `{ v: 1, ... }` so the codec can evolve.

Codec module `dashboard/src/features/analytics/share-state.ts`:
- `encodeAnalysisState(state: AnalysisState): string` → base64url string (no padding, `+/`→`-_`).
- `decodeAnalysisState(raw: string | undefined): Partial<AnalysisState> | null` → parsed state, or
  `null` when absent/blank/malformed (NEVER throws — a bad link falls back to defaults).
- `AnalysisState` is a discriminated shape per page kind, but share a common base:
  `{ v: 1; from?: string; to?: string; segmentId?: string | null }` plus page-specific fields
  (Insights: `events`, `interval`, `filters`, `breakdown`, `chartType`; Funnels: `steps`, `window`, …;
  Retention/Flows/Paths: their builder fields). Each page owns its own `PageAnalysisState` type; the
  codec is generic (`encode<T>`, `decode<T>`) so one module serves all pages.
- Robust decode: validate types field-by-field; drop unknown/invalid fields; clamp array lengths
  (e.g. ≤ the builder's max events/steps); ignore a `segmentId` shape that isn't a string. Malformed →
  return null.

### 3.2 State ↔ URL sync (per page)
A small hook `useUrlAnalysisState<T>(routeId, defaults, { serialize, deserialize })`:
- On mount / when the `s` param changes externally (back/forward), decode and return the hydrated
  state (merged over `defaults`).
- Expose a `pushState(next: T)` that the page calls when its builder state changes; it re-encodes and
  updates the URL via the router using **`replace: true`** (so tweaking the builder doesn't spam the
  history stack — one entry per view, not per keystroke) and **debounced** (~300ms) so rapid edits
  coalesce.
- Explicit "shareable moment" (clicking Run, or a Copy link) may `push` (new history entry) so
  back/forward between runs works — pick one: default to `replace` on edits, `push` on Run.
- Interaction with the global date range (`useDateRange`): if the URL carries `from`/`to`, they win for
  that view on load (and seed the control); otherwise the page uses the global range. Changing the
  range writes it back into the URL.

### 3.3 Copy link affordance
- A **Copy link** button in each analysis page header (near `DateRangeControl`), using an icon +
  `navigator.clipboard.writeText(window.location.href)`; on success a toast "Link copied"; guarded
  when clipboard is unavailable (fallback: select-and-copy or just no-op with a tooltip).
- Also add **Copy link** as a command-palette action ("Copy link to this view") for discoverability.

### 3.4 Pages in scope (in priority order)
1. **Insights** (most stateful; do first, prove the pattern end-to-end).
2. **Funnels**, **Retention**, **Flows**, **Paths** (each wires its own `PageAnalysisState`).
Home/Revenue/Live are range-only — they can carry `from`/`to` in the URL too (cheap), but the builder
serialization is the Insights-family value.

## 4. States & edge cases (make it great)
- **Empty/no param** → defaults, nothing weird in the URL until the user acts.
- **Malformed/old-version param** → ignored silently, defaults load, and the next edit rewrites a valid
  `s` (self-healing). Never show an error for a bad link — just fall back.
- **Stale segment id** (cohort deleted) → the segment picker shows "unknown / cleared"; the query drops
  `cohort_id`. Don't hard-fail.
- **URL length**: base64 compact JSON keeps typical states well under limits; if a state ever exceeds
  ~2000 chars, still works in modern browsers — but keep keys short. (No short-link service in scope.)
- **Back/forward**: navigating history re-hydrates the builder (the hook listens to the `s` param).
- **Auth redirect**: the existing `validateSearch` redirect param and the new `s` param must coexist —
  don't clobber other search params when writing `s`.
- **Accessibility**: Copy link is a real button with an accessible name; toast is polite-announced.

## 5. Testing
- `share-state.test.ts`: round-trip encode→decode for a rich Insights state; decode of `undefined`/
  `''`/garbage/`{v:2}` → null; type-coercion drops bad fields; array clamping.
- Insights page test: navigating to `/…/insights?s=<encoded>` hydrates the builder + auto-runs (assert
  the posted query body matches the encoded state); editing the builder updates `window.location`'s `s`
  (assert via the router/history); Copy link writes `location.href` to a mocked clipboard + toasts.
- Regression: existing Insights tests still pass (no param = current behavior).

## 6. Rollout / tasks
- T1: `share-state.ts` codec + `useUrlAnalysisState` hook + tests. Wire **Insights** end-to-end + Copy
  link button + palette action. (One commit.)
- T2: extend to **Funnels/Retention/Flows/Paths** (each its own `PageAnalysisState`). (One commit.)

## 7. Later extensions (not now)
- Opt-in server-side short links (needs a tiny backend table + route).
- "Reset to defaults" button; "Duplicate view".
- Embed mode (read-only view via a URL flag) — overlaps with the future Dashboard-sharing feature.
