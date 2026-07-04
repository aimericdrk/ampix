# Phase-3 core-analytics UI — report

Status: Done. All gates green (`pnpm format` clean; `pnpm --filter dashboard typecheck && lint && test && verify:build` all pass).

Commit: `feat(dashboard): Phase-3 analytics — insights builder, charts, live feed, users, sessions` (touches `dashboard/` + root `pnpm-lock.yaml` only; `backend/`, `sdk/`, `infra/` changes from concurrent agents were left untouched/unstaged).

## Routes/pages added
All project-scoped, linked via a new `ProjectAnalyticsNav` tab bar (Overview/Insights/Live/Users/Sessions) rendered on `ProjectDetailPage` and on every analytics page itself:
- `/projects/$projectId/insights` — `InsightsPage`: event picker (datalist autocomplete from `GET /meta/events`, per-event `total|unique_users`, 5-event cap), date range, interval select, AND filter builder (property from `GET /meta/properties`, op, value — value input hidden for `is_set`/`is_not_set`), optional breakdown. Run → `POST /query/insights`.
- `/projects/$projectId/live` — `LiveFeedPage`: `useInfiniteQuery` polls page 0 every 5s (`refetchInterval`) and "Load older" calls `fetchNextPage` against `next_before`.
- `/projects/$projectId/users` (+ `/users/$distinctId`) — `UsersPage`/`UserProfilePage`: search + `useInfiniteQuery` cursor pagination; profile shows properties, first/last seen, event count, recent-activity timeline.
- `/projects/$projectId/sessions` — `SessionsPage`: tiles (total sessions, `formatDurationMs` avg) + by-day line chart.

## Charts + palette
Chart types: line (default, time series), bar (magnitude, 4px rounded top radius, ≤24px bars), number tiles (per-series sum, compact-formatted), table (always rendered separately below the toggle, regardless of selection — never gated). Sessions page: single-series by-day line only, deliberately never combined with avg-duration on a second axis (no dual-axis).
Palette: `--series-1..8` + `--series-other` CSS vars added to `index.css` (`:root`/`.dark`) with the exact light/dark hex values given, plus `--chart-surface`; validated with the dataviz skill's `validate_palette.js` (PASS on lightness/chroma/contrast; CVD floor 8-12 acceptable given the mandatory legend+table secondary encoding). Components reference `var(--series-N)` directly (never hex), so dark mode is the selected `.dark` step, not an auto-invert. `palette.ts`'s `assignSeriesColors` orders distinct (event×breakdown) series by the builder's event-add order + breakdown value alpha — not by API response array order — so a filter that drops a series never repaints survivors; a 9th+ series folds into `--series-other`. Legend renders only for 2+ series; table is always present; tooltips/grid use `--surface`/`--border`/`--text-muted` tokens.

## Builder state → §14 query definition
`InsightsPage` state (events, date range, interval, filters, breakdown) IS assembled 1:1 into `InsightsQueryDefinition` (`lib/api/types.ts`) each render via `useMemo`; incomplete filter rows (missing value on value-requiring ops) are dropped before submit. Verified in `insights.test.tsx` by intercepting the mocked `POST /query/insights` body and asserting deep equality with the expected definition.

## Types + MSW
All §14 request/response types added to `lib/api/types.ts`. `test/msw/handlers.ts` gained deterministic fixtures + handlers for all 7 endpoints (insights compute is genuinely derived from the posted query; live events (30, newest-first) and users (22) fixtures are sized past the UI's page size so pagination is exercised for real, not simulated).

## Test summary
4 new spec files, 8 new tests (insights query-def + chart/table + toggle switching; live feed list + "load older"; users list/search/paginate + profile+timeline; sessions tiles+chart+table) — all MSW-driven, no mocked `apiFetch`. Full suite: 22 files / 102 tests (up from 18/94), all green. Coverage 94.35% lines / 86.37% branch (floor 75/70). `verify:build` passes (bundle warns >500kB due to recharts — expected, not a failure).

## Concerns
- Bundle size: recharts pulls in `@reduxjs/toolkit`/`redux` transitively (~242KB gzip total JS), triggering a Vite chunk-size warning. Not code-split; worth a `manualChunks` pass later if bundle size becomes a real budget concern.
- Did not verify chart rendering with an actual browser screenshot (no confirmed Chrome extension session in this run) — relied on the dataviz palette validator + component-spec review instead. Recommend a manual visual pass (light + dark) before shipping to design.
- `useLiveEvents`/`useUsersList` use `useInfiniteQuery`; TanStack Query's background refetch re-fetches every already-loaded page in sequence — fine against mocks, worth confirming acceptable request volume against the real backend once it lands.
