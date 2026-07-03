# MyAmpMix Dashboard — Design

**Date:** 2026-07-02
**Status:** Approved design
**Parent:** [Master design §5](./2026-07-02-analytics-platform-design.md) · **Must conform to:** [Shared contracts](./2026-07-02-shared-contracts.md)

## 1. Scope & Goals

The dashboard is the React compiled in a single-page application through which users explore analytics, manage projects/orgs, and build reports. It covers **all** dashboard delivery milestones (master design §8, phases 2–7); only the phase-1 milestone (app shell) has an implementation plan today (`../plans/2026-07-02-dashboard-shell-phase1.md`). Everything else in this document is design for later milestones.

Hard requirements inherited from the master design and shared contracts:

- Single static build (`dist/`) hostable on any static host/CDN; **one build deploys anywhere** via runtime `config.js`.
- Dev server on port 5173, proxying `/api` and `/ingest` to the backend on `http://localhost:8080` (contracts §2).
- All API errors are RFC 7807 problem details `{type, title, status, detail?, errors?}` (contracts §7).
- Auth: access JWT (15 min) held **in memory only**; refresh JWT (30 d) in an httpOnly cookie (contracts §7).
- Coverage floor 75% lines, CI-enforced (contracts §9).
- No paid services or SaaS dependencies.
- The style has to be Simple but we have as much informations as possiblewith charts graph lines between a list of element parcours...

## 2. Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Build | **Vite 6** | Static `dist/` output, dev proxy, fast HMR. |
| UI | **React 18** + **TypeScript 5.8+ strict** | `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. |
| Routing | **TanStack Router** | Typed routes, `beforeLoad` auth guards, search-param validation (report state in URLs). |
| Server state | **TanStack Query** | Caching, retries, polling (live feed), mutation lifecycle. |
| Components | **only homemade elements** | More work but better result |
| Charts | **Recharts** | Wrapped behind our own chart components (§9). |
| API mocking (tests) | **MSW** | Same handlers for Vitest (node) and Playwright/dev (browser worker). |
| Unit/component tests | **Vitest + Testing Library** | jsdom environment. |
| E2E | **Playwright** | Smoke path only (login → report → chart), per master §6. |
| Package manager | **pnpm 10**, workspace member `dashboard/` | Node 22 (contracts §1). |

Deliberately **not** used: Redux/Zustand (TanStack Query + a tiny auth store suffice), CSS-in-JS (Tailwind + CSS variables), Next.js/SSR (static SPA is a hard requirement), and **no component/headless-UI libraries** (Radix, Headless UI, shadcn…): every interactive primitive (dialog, toast, dropdown, tabs…) is built in-house in `src/components/ui` — more work, accepted for full control over behavior and style. The a11y obligations this transfers to us are spelled out in §11.

## 3. Application Architecture

Feature-folder structure. Each feature owns its components, hooks, and API bindings; cross-cutting code lives in `src/lib` and `src/components`.

```
dashboard/
├── index.html                  # loads /config.js BEFORE the module bundle
├── public/
│   ├── config.js               # runtime config template (overwritten at deploy)
│   └── mockServiceWorker.js    # MSW worker (dev/e2e only)
├── src/
│   ├── main.tsx                # bootstrap (optional MSW start) → render <App/>
│   ├── App.tsx                 # providers: ErrorBoundary > Query > Theme > Toast > Router
│   ├── router.tsx              # route tree + auth guards
│   ├── index.css               # Tailwind + theme CSS variables
│   ├── lib/                    # shared non-UI code
│   │   ├── config.ts           # runtime config loader
│   │   ├── cn.ts               # class-name merge helper
│   │   ├── theme.tsx           # ThemeProvider / useTheme
│   │   └── api/
│   │       ├── client.ts       # apiFetch: auth injection, 401 refresh+replay
│   │       ├── problem.ts      # RFC 7807 parsing, ApiError
│   │       └── types.ts        # API types (hand-written now, generated later, §6.1)
│   ├── components/
│   │   ├── ui/                 # base kit: button, input, card, dialog, toast, …
│   │   ├── charts/             # Recharts wrappers (§9)
│   │   ├── layout/             # AppLayout, Sidebar, ProjectSwitcher, ThemeToggle
│   │   ├── ErrorBoundary.tsx
│   │   ├── NotFoundPage.tsx
│   │   └── RouteErrorPage.tsx
│   ├── features/
│   │   ├── auth/               # store, api, validation, Login/Signup/Invite pages
│   │   ├── projects/           # projects list, project settings
│   │   ├── live/               # live event feed
│   │   ├── insights/           # insights builder
│   │   ├── funnels/ retention/ flows/
│   │   ├── users/              # explorer + profile
│   │   ├── cohorts/ dashboards/ attribution/
│   │   ├── org/                # members, roles, invitations
│   │   └── report-builder/     # shared query-definition state model (§7)
│   └── test/
│       ├── setup.ts            # jest-dom, jsdom polyfills, MSW lifecycle
│       ├── render-app.tsx      # renderApp(url) full-app test harness
│       └── msw/                # handlers.ts, server.ts (node), browser.ts (worker)
└── e2e/                        # Playwright smoke specs
```

Rules:

- Features may import from `lib/` and `components/`, never from other features (exception: everything may import `features/auth/store` and the `report-builder` model, which are de-facto shared kernels — revisit if it grows).
- All server communication goes through `lib/api/client.ts`; components never call `fetch` directly.
- Route components live in features; `router.tsx` only wires them together.

## 4. Runtime Configuration

One immutable build must run against any backend origin. Mechanism:

1. `index.html` loads a **plain script before the bundle**:

```html
<head>
  ...
  <script src="/config.js"></script>
</head>
```

2. `public/config.js` (copied verbatim into `dist/`) is a template each deployment overwrites — it is *not* processed by Vite:

```js
// Runtime configuration — overwrite this file at deploy time. Do not import from the bundle.
window.__MYAMPMIX_CONFIG__ = {
  apiBaseUrl: '', // '' = same origin (dev proxy / reverse-proxied prod). Or e.g. 'https://api.myampmix.example'
};
```

3. The loader merges injected values over dev fallbacks:

```ts
export interface RuntimeConfig {
  apiBaseUrl: string;
}

export function getRuntimeConfig(): RuntimeConfig {
  return { apiBaseUrl: '', ...window.__MYAMPMIX_CONFIG__ };
}
```

- In dev, `apiBaseUrl: ''` + the Vite proxy (`/api`, `/ingest` → `http://localhost:8080`, contracts §2) means no CORS.
- In prod, either serve the SPA behind the same reverse proxy as the API (keep `''`) or point `apiBaseUrl` at the Cloud Run URL (backend must then allow the dashboard origin in CORS).
- `config.js` is never fingerprinted/cached-busted; deployments set `Cache-Control: no-cache` on it and long-lived caching on hashed assets.
- No `import.meta.env.VITE_*` values may leak backend origins into the bundle (test-only flags like `VITE_ENABLE_MSW` are allowed).

## 5. Authentication & Session Handling

Per contracts §7: `POST /api/v1/auth/signup|login|refresh|logout`. Access JWT ~15 min, refresh JWT 30 d in an httpOnly cookie scoped to the auth endpoints.

**Storage model**

- Access token: **JS memory only** (module-level auth store). Never localStorage/sessionStorage — XSS cannot exfiltrate what isn't persisted.
- Refresh token: httpOnly cookie, invisible to JS; all API calls use `credentials: 'include'`.
- Auth store states: `unknown` (fresh page load) → `authenticated` | `anonymous`.

**Flows**

```
Login/Signup:  form → POST auth/login → {access_token, user} + Set-Cookie refresh
               → store.setSession() → navigate to ?redirect= or /projects

Page reload:   store = unknown → router beforeLoad awaits restoreSession()
               → POST auth/refresh (cookie) → 200: authenticated / 401: anonymous → /login

Expired token: any API 401 (non-auth endpoint)
               → single-flight POST auth/refresh
                  → 200: update token, REPLAY original request once
                  → 401: clearSession → guard redirects to /login?redirect=<attempted>

Logout:        POST auth/logout (server revokes refresh) → clearSession → /login
```

Rules:

- Silent refresh is **single-flight**: concurrent 401s share one refresh promise; exactly one `/auth/refresh` call.
- A replayed request that 401s again is a hard failure (no retry loops).
- Auth endpoints themselves are never refresh-retried.
- Route guards: private routes `beforeLoad` → await session resolution → `redirect({ to: '/login', search: { redirect: location.href } })` when anonymous; `/login`/`/signup` redirect authenticated users to `/projects`.

## 6. API Layer

### 6.1 Typed client

Target state: the backend generates an OpenAPI spec from NestJS decorators (master §5), and the dashboard generates types from it (e.g. `openapi-typescript`) into `src/lib/api/types.ts` — no drift between layers. **Until backend spec generation lands, `types.ts` is hand-written from contracts §7** with identical names, so swapping to generation is a codegen change, not a refactor.

`apiFetch<T>(path, options)` is the single transport:

- Prefixes `getRuntimeConfig().apiBaseUrl`, sets `credentials: 'include'` and JSON headers.
- Injects `Authorization: Bearer <accessToken>` from the auth store.
- Implements the 401 silent-refresh-and-replay of §5.
- Non-2xx → throws `ApiError` carrying a normalized `ApiProblem`.

### 6.2 TanStack Query wrappers

Each feature exposes hooks in its `api.ts` (e.g. `useProjects()`, `useInsightsQuery(projectId, query)`), built on `apiFetch` with structured query keys:

```
['projects']
['projects', projectId]
['projects', projectId, 'live', cursor]
['projects', projectId, 'query', 'insights', hash(queryDef)]
```

Defaults: `retry: 1` (never retry 4xx — retry predicate checks `ApiError.problem.status`), `refetchOnWindowFocus: false`, `staleTime` 30 s for report queries, 0 for live feed. Report queries are `POST`s but modeled as *queries* (keyed on the definition hash), not mutations.

### 6.3 Error normalization & surfacing

All error paths funnel into one shape (contracts §7):

```ts
interface ApiProblem {
  type: string;      // 'about:blank' when absent
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string[]>; // field-level validation errors
}
class ApiError extends Error { readonly problem: ApiProblem }
```

Non-JSON/opaque failures (network down, HTML from a proxy) normalize to a synthetic problem (`status: 0` or the HTTP status, `title` from `statusText`).

Surfacing strategy:

| Situation | Surface |
|---|---|
| Form submission 4xx (login 401, signup 409, validation `errors`) | **Inline**: field errors from `problem.errors`, form-level message from `problem.title`. No toast. |
| Query load failure (page data) | **Inline** error state in the page/panel with retry button. |
| Background/mutation failure not tied to a visible form (save report, delete token), 5xx, network | **Toast** (error variant) with `problem.title`. |
| 401 after failed refresh | No toast; redirect to `/login` (expected flow). |
| 403 | Inline "You don't have permission" panel (role-aware UI should prevent most). |

## 7. Report-Builder State Model (single source of truth)

The **typed JSON query definition of contracts §7 is the canonical state** of every report builder. The builder UI is a pure editor of that object; charts render the response of submitting it; saved reports persist it verbatim. There is no separate "UI state model" that gets translated — what you edit is what is sent and what is saved.

```ts
// Mirrors contracts §7 exactly (insights, phase 3); funnels/retention/flows extend the same pattern (phase 4).
export interface InsightsQuery {
  events: { name: string; aggregation: 'total' | 'unique_users' }[];
  date_range: { from: string; to: string };          // ISO dates, project TZ applied server-side
  interval: 'hour' | 'day' | 'week' | 'month';
  filters?: PropertyFilter[];
  breakdown?: { property: string };
}
export interface PropertyFilter {
  property: string;
  op: 'eq' | 'neq' | 'contains' | 'set' | 'not_set' | 'gt' | 'lt';
  value?: string | number | boolean;
}
export interface InsightsResponse {
  series: { name: string; data: { t: string; value: number }[] }[];
}

// Saved report envelope (stored by the backend `dashboards` module):
export interface ReportDefinition {
  kind: 'insights' | 'funnel' | 'retention' | 'flows';
  query: InsightsQuery /* | FunnelQuery | RetentionQuery | FlowsQuery */;
  visualization: 'line' | 'bar' | 'pie' | 'table' | 'number';
}
```

Consequences:

- **URL-shareable**: the builder serializes `ReportDefinition` into the route search params (TanStack Router `validateSearch` + JSON encoding), so any report view is a copy-pasteable link and back/forward works.
- **Saving** a report = `POST` the `ReportDefinition` as-is; **loading** = hydrate builder state from it. Dashboards store report ids + grid layout, never query copies.
- Formula support (`A/B`, master §5) and and/or filter groups (master §4) are **contract extensions**: they must be added to contracts §7 before the dashboard implements them (tracked for phase 3/4).
- Reducer-style updates (`useReducer` over `ReportDefinition`) with exhaustive unit tests — this is the highest-value test surface in the app (master §6).
- Query submission is debounced (~400 ms after last edit) with in-flight cancellation via TanStack Query.

## 8. Page Inventory

All routes below `/projects/:projectId/*` render inside `AppLayout` (sidebar + header). "Endpoints" reference contracts §7 shapes; endpoints not yet in the contracts are marked *(contract TBD)* and must be added there before implementation. Phases refer to master §8.

### 8.1 Auth pages — `/login`, `/signup`, `/invite/:token` (phase 2 / shell)

Centered card on a plain background; no app chrome.
- **Login**: email + password, inline validation, form-level error on 401, link to signup. Submit → `/projects` (or `?redirect=`).
- **Signup**: name + email + password (min 8), 409 → inline "email already registered".
- **Invite acceptance**: reads signed token from path, shows org name + role *(contract TBD: `GET /api/v1/invitations/:token`)*; existing session → "Join org" button; otherwise embeds the signup form with email prefilled. Phase-1 shell ships a placeholder.

### 8.2 Projects list — `/projects` (shell)

Grid of project cards (name, timezone) → click enters `/projects/:id`. Empty state: "Create your first project" (admin only). *(contract TBD: `POST /api/v1/projects`)*.

### 8.3 Live event feed — `/projects/:id/live` (phase 3)

```
[Event name filter ▾] [distinct_id search] [⏸ pause]           ● live
┌──────────────────────────────────────────────────────────────┐
│ 12:03:41  $screen_view   u_42        screen=Checkout   ios   │  ← row expands to
│ 12:03:40  checkout_completed u_42    plan=pro value=9.99     │    full JSON props
└──────────────────────────────────────────────────────────────┘
```
- `GET /projects/:id/events/live?limit=50&before=<cursor>` polled every 3 s via TanStack Query `refetchInterval`; new rows prepend with subtle highlight; pause stops polling; cursor pagination scrolls back in time. Virtualized list (up to ~1k rows retained).

### 8.4 Insights builder — `/projects/:id/insights` (phase 3)

The reference report-builder layout, reused by funnels/retention/flows:

```
┌ sidebar ┬───────────────────────────────────────────────┐
│         │ [Date range ▾] [Interval ▾]   [Save ▾] [CSV]  │
│         ├───────────────┬───────────────────────────────┤
│         │ QUERY PANEL   │  CHART AREA                   │
│         │ A ▸ event ▾   │  [line|bar|pie|table|number]  │
│         │   agg ▾       │                               │
│         │ + add event   │      (Recharts render of      │
│         │ Filters       │       InsightsResponse)       │
│         │ + add filter  │                               │
│         │ Breakdown ▾   ├───────────────────────────────┤
│         │               │  result table (toggle)        │
└─────────┴───────────────┴───────────────────────────────┘
```
- Left panel edits `InsightsQuery` (§7): multi-event (A, B, C…), per-event aggregation, property filters, one breakdown, formulas like `A/B` (contract extension).
- Event/property names come from autocomplete endpoints *(contract TBD: `GET /projects/:id/meta/events`, `/meta/properties`)*.
- `POST /projects/:id/query/insights` on debounced change; visualization switcher maps the same `series` response onto chart wrappers (§9); Save opens dialog (name, optional dashboard) → saved report.

### 8.5 Funnels builder — `/projects/:id/funnels` (phase 4)

Same builder chrome; query panel = **ordered step editor** (drag to reorder, per-step filters), conversion window (count + unit), breakdown. Chart area: horizontal funnel bars with conversion % between steps + summary table (step, users, conversion, median time to convert). `POST /projects/:id/query/funnels`.

### 8.6 Retention — `/projects/:id/retention` (phase 4)

Query panel: birth event ▾, return event ▾, granularity (day/week/month), date range. Chart area: **cohort triangle grid** — rows = cohort start date + size, columns = period 0..N, cells shaded by % (sequential scale, value on hover/in-cell), plus average-curve line chart. `POST /projects/:id/query/retention`.

### 8.7 User Flows — `/projects/:id/flows` (phase 4)

Query panel: anchor event, direction (from/to), depth (1–5 steps), min-path threshold. Chart area: **sankey** (Recharts `Sankey`) of event sequences; "other/drop-off" nodes aggregate the tail; node click drills into the segment. `POST /projects/:id/query/flows`.

### 8.8 Users explorer — `/projects/:id/users` (phase 3)

Filter bar (property conditions, same `PropertyFilter` vocabulary) + search by `distinct_id`/email property → paginated table (distinct_id, key profile props, last seen, event count). Row → profile.

### 8.9 User profile — `/projects/:id/users/:distinctId` (phase 3)

Two columns: left card = profile properties (JSON key/values), identity mappings (linked anon ids), cohort memberships; right = **activity timeline** — reverse-chronological events grouped by session with session duration headers, expandable rows, infinite scroll.

### 8.10 Cohort builder — `/projects/:id/cohorts` (phase 5)

List of cohorts (name, size, last refreshed) + builder dialog/page: condition groups combining **behavioral** ("performed `checkout_completed` ≥ 3 times in last 30 days") and **property** ("plan = pro") conditions with AND/OR; live size preview (debounced count query); saved cohorts become filter/breakdown values in all builders.

### 8.11 Dashboards — `/projects/:id/dashboards/:dashboardId` (phase 5)

Drag-and-drop **grid of saved-report tiles** (12-column layout persisted per dashboard; CSS grid + a small DnD layer). Each tile renders its report's `ReportDefinition` at tile size (NumberTile/line/bar/pie), with kebab menu (edit report, resize, remove). Global date-range override; auto-refresh interval selector (off/1m/5m); add-tile picker of saved reports.

### 8.12 Attribution report — `/projects/:id/attribution` (phase 6)

First-touch/last-touch toggle; table + bar breakdown of installs, signups, and any chosen conversion event by `utm_source`/`utm_campaign` (Meta/TikTok/Google enrichment fields from the backend attribution module); date range; per-campaign drill-down.

### 8.13 Project settings — `/projects/:id/settings` (phase 2+)

Tabs: **General** (name, timezone), **SDK tokens** (list `mam_…` tokens masked with reveal/copy, create with label, revoke with confirm dialog), **Data management** (GDPR delete/export by distinct_id — phase 7). Admin-gated.

### 8.14 Org admin — `/org` (phase 2)

Tabs: **Members** (table: name, email, role ▾ admin/analyst/viewer, remove), **Invitations** (create → shareable signed link with copy button + expiry, list pending/revoke). Role changes are optimistic with rollback on error. Admin-gated; viewers/analysts see a 403 panel.

### 8.15 System pages

Not-found route (404 page with link home), route-level error page (router `errorComponent`), and a top-level `ErrorBoundary` (crash card + reload) — all in the shell.

## 9. Charts

Recharts is wrapped once in `src/components/charts/`; feature code never imports Recharts directly (swap-ability, consistent theming/formatting):

| Wrapper | Renders | Consumes |
|---|---|---|
| `TimeSeriesChart` | line (or stacked area) over time | `InsightsResponse.series` directly |
| `BreakdownBarChart` | vertical/horizontal bars | series (one bar group per breakdown value) |
| `SharePieChart` | pie/donut of series totals | series |
| `ResultTable` | sortable table, sticky header, CSV export hook | series |
| `NumberTile` | big number + delta vs previous period + sparkline | single-series |

Shared behavior: theme-aware colors from CSS variables (categorical palette of 8, defined once for light and dark); shared tooltip (localized date + formatted value); axis number formatting (`1.2k`, `3.4M`); `ResponsiveContainer` sizing; loading skeleton and empty state ("No data for this range") built into every wrapper; each chart has a visually-hidden data-table alternative for screen readers.

## 10. Theming

Light/dark via a `dark` class on `<html>` and **CSS variables** consumed by Tailwind (v4 `@theme inline`):

```css
:root  { --bg: …; --surface: …; --border: …; --text: …; --text-muted: …; --accent: …; --accent-fg: …; --danger: …; }
.dark  { /* same variables, dark values */ }
@theme inline { --color-bg: var(--bg); --color-surface: var(--surface); /* … */ }
```

- `ThemeProvider` initializes from `localStorage('myampmix-theme')` → `prefers-color-scheme` → light; toggle in the sidebar persists the choice.
- Components only use semantic tokens (`bg-surface`, `text-text-muted`, `border-border`, `bg-accent`…); raw palette values appear only in `index.css`. Chart palette variables live alongside.

## 11. Accessibility Baseline

- Radix primitives for all interactive composites (dialog, dropdown, toast, tabs, switch) → correct roles, focus trapping, `Esc`, arrow-key behavior for free.
- Every input has a `<label htmlFor>`; validation errors use `role="alert"` and `aria-invalid` on the field; loading states use `role="status"`.
- Full keyboard operability; visible `:focus-visible` outline (accent, 2px offset); logical tab order; skip-to-content link in `AppLayout`.
- Color contrast ≥ 4.5:1 for text in both themes (checked when tokens change); data is never encoded by color alone (labels/patterns in charts, § 9 table fallback).
- `prefers-reduced-motion` respected (no animated chart transitions).
- Testing Library queries by role/label enforce semantics in every component test; Playwright smoke runs an axe scan on login + projects pages (later milestone).

## 12. Testing Strategy

| Layer | Tool | What |
|---|---|---|
| Pure logic (config, problem parsing, validation, report-definition reducers) | Vitest | Exhaustive unit tests; the report-builder model gets the deepest suite (mirrors backend query-builder rigor, master §6). |
| Components (UI kit, charts, forms) | Vitest + Testing Library | Behavior via roles/labels, not snapshots. |
| API layer & auth flows | Vitest + **MSW (node)** | Handlers implement contracts §7 verbatim (RFC 7807 bodies, auth endpoints, token checks); tests cover refresh/replay, single-flight, session restore. |
| Route integration | Vitest + Testing Library + MSW | `renderApp(url)` mounts the real route tree with memory history: guards, redirects, page data states. |
| E2E smoke | **Playwright** against the app with the MSW browser worker (no backend) | Boot → login → land on projects (shell); later: create report → see chart. Kept to a handful of specs. |
| Build | CI step | `tsc --noEmit`, `vite build`, assert `dist/index.html` + `dist/config.js` exist. |

Coverage floor **75% lines** (contracts §9), enforced by `vitest --coverage` thresholds in CI. MSW handlers are shared between node tests, the dev browser worker, and Playwright — one mock source of truth.

## 13. Milestone Map (dashboard slice of master §8)

| Milestone | Contents | Plan |
|---|---|---|
| **1. Shell** | Scaffold, config.js, theming, UI kit, API client + auth, router/guards, login/signup, layout, projects list, error/404, test rigs, CI-ready build | `../plans/2026-07-02-dashboard-shell-phase1.md` ✅ |
| 2. Tenancy UI | Org admin, invitations, project settings + SDK tokens, project create | later plan |
| 3. Core analytics | Charts package, report-builder model, insights builder, live feed, users explorer + profile | later plan |
| 4. Advanced analysis | Funnels, retention, flows | later plan |
| 5. Cohorts & dashboards | Cohort builder, saved reports, dashboard grid | later plan |
| 6. Attribution | Attribution report | later plan |
| 7. Polish | CSV export UI, GDPR tooling UI, axe audits, docs | later plan |

## 14. Assumptions & Open Questions

1. **Auth response body** *(assumed, needs backend confirmation)*: `{ "access_token": string, "user": { "id", "email", "name" } }` for login/signup/refresh; `204` for logout. snake_case JSON to match the ingest contract style.
2. **Projects endpoint** *(assumed)*: `GET /api/v1/projects` → `{ "projects": [{ "id", "org_id", "name", "timezone" }] }`, matching Postgres schema (contracts §6).
3. **OpenAPI codegen**: phase 1 hand-writes `types.ts` from contracts §7; swap to generated types when the backend publishes its spec (§6.1).
4. Formulas and and/or filter groups require contracts §7 extensions before phases 3–4 implement them.
5. Invite-token metadata endpoint (`GET /api/v1/invitations/:token`) needs to be added to the contracts for milestone 2.
