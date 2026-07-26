# Dashboard tool rail — Design

**Date:** 2026-07-16
**Status:** Approved (design), pending implementation plan
**Scope:** `dashboard/` only — nav model, routing, `AppLayout` chrome
**Branch base:** `feat/revenuecat-integration`

## Problem

The dashboard sidebar is one flat list of every page, driven by `projectGroups()`
in `dashboard/src/components/layout/nav-model.ts`. MyAmpix is a recreation of
Amplitude, and a second tool — a RevenueCat-shaped subscription product — is being
added alongside it. A single list cannot express "which tool am I in", and there
is no place to add a third tool later.

Today RevenueCat exists in the UI as exactly one page (`Subscriptions`), filed
under the `Explore` group next to `Revenue`, and hidden entirely when the project
has no RevenueCat integration.

## Solution

Split the sidebar into two columns:

- a narrow **tool rail** (left) — one button per tool, plus global identity chrome;
- the existing **section list** (right) — the selected tool's pages.

```
┌─────┐ ┌──────────────────┐
│  M  │ │ [Acme Corp    ▾] │
│─────│ │ [Mobile App   ▾] │
│  ⌂  │ │ [ ⌘K Search... ] │
│ MyA │ ├──────────────────┤
│     │ │  ▪ Home          │
│  ▣  │ │ EXPLORE          │
│ MyR │ │  ▪ Insights      │
│     │ │  ▪ Funnels       │
│─────│ │  ▪ Revenue       │
│  ◑  │ │ AUDIENCE         │
│  ●  │ │  ▪ Cohorts       │
└─────┘ └──────────────────┘
 global      project-scoped
```

The rail owns what is **global** (wordmark, tools, identity). The second column
owns what is **project-scoped** (org switcher, project switcher, command palette,
the tool's nav). The visual split maps onto a real conceptual one.

## Scope

**In scope:** the nav model's tool dimension, `/rc/*` routes, `AppLayout`'s two-column
chrome, splitting `SubscriptionsPage` along its existing query seam, placeholder
pages for unbuilt RC pages, surfacing the orphaned `/flows` route.

**Explicitly out of scope** — each is its own spec:

1. **Extracting RevenueCat into a separate backend service.** Decided in principle
   (see *Deferred decisions*), not designed here.
2. **Building the unbuilt RC pages** (Charts, Customers, Products, Entitlements,
   Offerings, Paywalls). This spec ships their nav entries and placeholder routes only.
3. **A deploy pipeline.** The app is not currently deployed anywhere.

## Decisions (locked)

- **Tool set:** `MyAmplitude` + `MyRevenueCat`. A third tool is one entry in `TOOLS`.
- **RevenueCat is a mirror, not a clone.** The real RevenueCat stays the source of
  truth (webhooks + API v2 backfill). We build an RC-shaped UI over mirrored data.
  We are not validating receipts or owning entitlements.
- **`Revenue` stays in MyAmplitude.** It reads the SDK's `$in_app_purchase` events,
  not RevenueCat data — it works with no RevenueCat account at all. See *Revenue vs Overview*.
- **The MyRevenueCat rail button is always visible.** On an unconnected project it
  routes to a connect screen rather than empty charts. This reverses today's
  behavior (hiding `Subscriptions`), which makes the feature undiscoverable to
  exactly the people who haven't adopted it.
- **URLs are namespaced:** `/projects/$projectId/rc/*`. Active tool derives from the
  pathname — no new state.
- **`Subscriptions` splits into `Overview` + `Conversion`** along its existing query seam.
- **Command palette stays cross-tool.** Its value is jumping to *anything*.
- **Tool click lands on the tool's home route.** No per-tool memory of the last page.
- **`/flows` joins MyAmplitude → Explore.** It is a live, built, unreachable route.

## Nav model

`nav-model.ts` gains a tool dimension. `NavItem`, `NavGroup`, and `NavAccent` are unchanged.

```ts
export type ToolId = 'amplitude' | 'revenuecat';

export interface Tool {
  id: ToolId;
  label: string;        // 'MyAmplitude'
  icon: IconName;
  home: string;         // route pattern for the tool's landing page
  groups: NavGroup[];
}
```

Two accessors, deliberately distinct:

| Accessor | Returns | Consumer |
|---|---|---|
| `toolGroups(toolId, opts?)` | one tool's groups | `AppLayout` sidebar |
| `allGroups(opts?)` | every tool's groups, flattened | `CommandPalette`, `keyboard-shortcuts` |

`opts` is `{ rcEnabled?: boolean }` and is **optional**: omitting it returns every
page ungated. This is required — `keyboard-shortcuts.ts` calls `allGroups()` at
module scope, where no `rcEnabled` can exist (see *Test impact*). Callers that have
`rcEnabled` pass it; the module-scope caller does not and does not need to.

**The RC gate moves into the accessors.** Today `i.to.endsWith('/subscriptions')` is
copy-pasted verbatim in `AppLayout.tsx:146` and `CommandPalette.tsx:142` with
*different* `useMemo` dependency arrays (`[projectId, rcEnabled]` vs `[rcEnabled]`),
and is absent from `keyboard-shortcuts.ts`. Adding a `toolId` argument forces both
call sites to be touched anyway; folding the gate into the model collapses the
duplication and the dep-array hazard into one signature change.

Note the gate now means "hide RC's *data* pages when disconnected", not "hide the
tool" — the tool button and its connect route always render.

### MyAmplitude groups

Unchanged from today's `projectGroups()`, except **`Flows` is added to `Explore`**
(after `Funnels`) and **`Subscriptions` is removed** (it moves to MyRevenueCat).

| Group | Accent | Items |
|---|---|---|
| — | violet | Home |
| Explore | cyan | Insights, Funnels, **Flows**, Retention, Paths, Heatmap, Revenue, Distributions, Properties, Events |
| Audience | pink | Cohorts, Users, Sessions, Live |
| Saved | amber | Dashboards, Reports, Templates |
| — | lime | Project settings |

### MyRevenueCat groups

| Group | Accent | Items | State |
|---|---|---|---|
| Monitor | lime | Overview | **live** — today's `Subscriptions` §0–5 |
| Monitor | lime | Charts, Customers | placeholder |
| Monetize | amber | Products, Entitlements, Offerings, Paywalls | placeholder |
| Analyze | cyan | Conversion | **live** — today's `Subscriptions` §6–8 |
| — | violet | Integration settings | **live** — `/rc/settings`, renders existing `IntegrationsSection` |

`Integration settings` gets its own `/rc/settings` route rather than linking to
`/projects/$projectId`. The active tool is derived from the pathname, so pointing it
at project settings would eject you from MyRevenueCat the moment you clicked the one
item whose job is configuring it. `IntegrationsSection` is already exported and
already switches between the connect form and the connected panel off its own
`useRcStatus`, so it is reused whole — one connect/manage surface, rendered in two
places (project settings and `/rc/settings`).

Accents reuse the existing five fixed hues; no new hue is introduced.

### Why `Subscriptions` splits where it does

`SubscriptionsPage` is one scrolling page fed by **two** queries, and the boundary
is already there:

- **§0–5** (`useSubscriptionsSummary`) — MRR / active / in-trial / new / churned /
  trial→paid KPIs, new-subscriptions trend, churn-reason donut, by-product,
  by-store, recent events. Honors global filters. → **Overview**
- **§6–8** (`useSubscriptionAttribution`) — conversion drivers, time-to-convert,
  trial funnel. **Ignores global filters.** → **Conversion**

The split follows the query seam, so neither page straddles a data source.

**Bug to fix during the split:** §6–8 currently render *outside* the `{data && ...}`
guard that wraps §0–5, so attribution sections display even when the summary query
fails. Splitting the pages makes each responsible for its own loading/error state
and removes the shared-guard asymmetry.

**`Conversion` is not a RevenueCat feature.** It correlates RC subscription events
against the SDK's own event stream ("what did users do before converting"). Real
RevenueCat cannot do this — it has no event stream. It is grouped under `Analyze`
rather than `Monitor` to reflect that it is a MyAmpix capability, not a mirror of RC's IA.

## Revenue vs Overview

These two pages look like siblings and share nothing. This is a known, accepted
inconsistency, recorded here so it is not rediscovered as a bug:

| | Revenue (MyAmplitude) | Overview (MyRevenueCat) |
|---|---|---|
| Source | ClickHouse `$in_app_purchase` events | RevenueCat webhook journal |
| Origin | your SDK's autocapture | RevenueCat's servers |
| "By product" units | dollars, from event `$price` | cents, from RC state |
| Gated | no | yes (`rcEnabled`) |

A project with both connected sees two "by product" tables that **will disagree**
on the same product IDs, with nothing reconciling them. Placing them in different
tools makes the distinction structural rather than relying on a user noticing.

Reconciliation, or an in-UI explanation of the discrepancy, is a follow-up.

## Routing

Nine new routes, all flat siblings of `privateRoute`, declaring full path strings —
matching the existing 27 exactly. No layout route: `reports/$reportId` and
`dashboards/$dashboardId` already prove multi-segment flat paths work, and an `rc`
layout route would be the codebase's first nested layout for no gain.

| Path | Component |
|---|---|
| `/projects/$projectId/rc/overview` | `RcOverviewPage` (from `SubscriptionsPage` §0–5) |
| `/projects/$projectId/rc/conversion` | `RcConversionPage` (from `SubscriptionsPage` §6–8) |
| `/projects/$projectId/rc/charts` | placeholder |
| `/projects/$projectId/rc/customers` | placeholder |
| `/projects/$projectId/rc/products` | placeholder |
| `/projects/$projectId/rc/entitlements` | placeholder |
| `/projects/$projectId/rc/offerings` | placeholder |
| `/projects/$projectId/rc/paywalls` | placeholder |
| `/projects/$projectId/rc/settings` | `RcSettingsPage` (renders `IntegrationsSection`) |

**`/projects/$projectId/subscriptions` becomes a redirect to `/rc/overview`**, so
existing bookmarks and links survive. It follows the `indexRoute` / `securitySettingsRoute`
pattern (`beforeLoad` throws `redirect(...)`).

**Const naming:** a `subscriptionsRoute` const already exists at `router.tsx:269`.
New consts are `rcOverviewRoute`, `rcConversionRoute`, etc.

**Active tool resolution:** `pathname.includes('/projects/') && pathname.includes('/rc/')`
→ `revenuecat`, else `amplitude`. Derived, never stored.

### Connect state

When `!rcEnabled`, MyRevenueCat's data pages are filtered out of the nav and the
tool's home resolves to a connect screen. The screen renders the existing
`IntegrationsSection` rather than duplicating a form. `Integration settings` remains
visible in the nav regardless, since it is how you connect.

Non-admins cannot connect (`IntegrationsSection` is gated on `project && isAdmin`).
For a non-admin on an unconnected project the connect screen must explain that an
admin needs to connect RevenueCat, not show a form that will 403.

## Placeholder pages

A shared `RcPlaceholderPage` component taking a title and a one-line description of
what will live there. Not a 404 — the IA is walkable immediately, and the nav
doesn't lie about what exists.

## Layout and accessibility

**Two `<nav>` elements, named distinctly:**

| Element | `aria-label` | Contents |
|---|---|---|
| rail | `Tools` | tool buttons |
| second column | `Primary` | the active tool's groups |

This naming is load-bearing. `Primary` continues to mean "the current tool's
sections", so every existing test asserting that Home / Funnels / Paths / Templates
and the Explore / Audience / Saved headings live inside one `Primary` nav keeps
passing — they are all MyAmplitude pages.

**Rail contents** (top → bottom): `M` monogram wordmark; tool buttons; spacer;
theme toggle; avatar button opening a popover with email, Account, Organization
settings, Log out.

**Second column contents** (unchanged from today except the nav source): org
switcher, project switcher, command palette, the active tool's nav, `Projects` link.

**No project selected** (`/projects`, `/account`, `/orgs/*`): tool buttons hide,
matching today's `groups = []`. The rail still renders wordmark + identity, so
layout doesn't jump.

**Rail width:** a new `--rail-w` token. No sidebar width token exists today — the
`w-60` on `<aside>` is a hardcoded class — so this introduces one rather than
hardcoding a second magic width.

**Mobile:** the existing `md:hidden` top bar and `mobileOpen` drawer are preserved.
Below `md`, rail and section list stack inside the one drawer; the drawer stays a
single scroll container.

**Accent:** `activeGroupAccent` continues to resolve against the *active tool's*
groups and stamp `data-accent` on `#main-content`. Its `?? 'violet'` fallback is
unchanged, and no longer misfires: because the active tool is derived from the
pathname, the active route always belongs to the current tool.

## Test impact

**Keeps passing, by design:**

- `app-layout.test.tsx` L44 / L62 — Home/Funnels/Paths/Templates and the three
  headings, all within the single `Primary` nav.
- `app-layout.test.tsx` L73 — `data-accent="cyan"` on `#main-content` for Insights.
- `app-layout.test.tsx` L104 — theme toggle; accessible name unchanged as a rail icon button.
- `app-layout.test.tsx` L25 — `Projects` link; the assertion is unscoped `getByRole`.
- `ShortcutsHelp.test.tsx`, `keyboard-shortcuts.test.tsx` — see below.
- `router.test.tsx` — asserts nothing about the sidebar.

**`SHORTCUT_ROUTES` stays a module-level const.** Every lettered shortcut
(`h`, `i`, `f`, `r`, `u`, `d`, `v`) points at a MyAmplitude page, and no RC page
gets a letter. So it derives from `allGroups()` at import time exactly as today,
and `ShortcutsHelp` — a pure presentational component — is untouched. If an RC page
ever earns a letter, this becomes a hook and cascades into `ShortcutsHelp` and two
test files; that cost is deferred, not paid.

`NAV_SHORTCUT_LETTERS` is string-keyed and silently lossy — a moved or renamed label
drops its shortcut with no type error and no failing test. Out of scope to fix, but
the implementation must not rename any lettered label.

**Requires updating:**

- `app-layout.test.tsx` L35 — `Organization settings` as a direct link with an `href`.
  It moves into the avatar popover, so the test needs an opening click.
- `app-layout.test.tsx` L117 / L129 — `Log out`; same reason.
- `app-layout.test.tsx` L19 — the `TEST_USER.email` assertion; same reason.
- `subscriptions.test.tsx` L34–49 — asserts `Subscriptions` appears/disappears from
  the `Primary` nav by `rcEnabled`. Rewrite against the new model: MyRevenueCat's
  *rail button* is always present; its *data pages* are gated.

**New tests:**

- rail renders one button per tool; the active tool is marked.
- clicking a tool navigates to its home route.
- MyRevenueCat's rail button renders on an unconnected project and routes to connect.
- `/subscriptions` redirects to `/rc/overview`.
- `allGroups()` includes both tools' pages; `toolGroups()` includes exactly one tool's.
- command palette finds a MyRevenueCat page while MyAmplitude is active.

## Risks

- **The `Primary`/`Tools` naming is what saves the test suite.** Renaming the second
  column's nav, or splitting the groups across both navs, cascades into every
  sidebar test. Don't.
- **The avatar popover is the only real regression risk** — it turns three
  directly-clickable controls into two-step interactions. Accepted for the rail
  design; the alternative was leaving the bottom cluster in the second column.
- **`router.tsx` is the real source of truth for what resolves; `nav-model.ts` is a
  hand-maintained mirror.** They already disagree (`/flows`). This spec fixes the
  known drift but does not make the mirror automatic — a new route still needs a
  matching nav entry by hand.

## Deferred decisions (recorded, not designed here)

**Extracting RevenueCat into a separate backend service** — *decided in principle:
a separate NestJS service that shares the existing Postgres and ClickHouse.*

The investigation behind that choice, so it isn't repeated. Findings below were
produced by a fan-out probe and then adversarially verified (43 claimed couplings,
39 confirmed, 9 genuine blockers, 4 refuted).

**The headline: the read side is clean. Every genuine blocker is on the write path.**

There are **no cross-store joins in the codebase**. No query concatenates a Postgres
result into ClickHouse SQL, and no `distinct_id` list is shipped from Postgres into
ClickHouse. Attribution — Conversion drivers, Time to convert, Trial funnel — never
reads `SubscriptionState` at all; it is 100% ClickHouse, joining `events` against
`events`. `rc-attribution.service.ts` touches Postgres only for a 404 existence gate
on the integration row (`:67`) and the standard membership check.

Consequence: **RC's Postgres-resident state (`SubscriptionState`,
`RevenueCatIntegration`, `RevenueCatWebhookEvent`) can move to a separate database
with zero read-path query changes.** `rc-summary` reads both stores, but as an
application-level `Promise.all` fan-out merged in code — a stitch, not a join, and
cleanly separable.

What actually blocks a full split, all of it write-path or identity:

1. **The RC webhook writes `$rc_*` rows directly into the analytics `events` table.**
   `rc-webhook.processor.ts:136` calls the same `clickhouse.insertEvents()` the SDK
   ingest path calls. This is *why* attribution needs no join — RC lifecycle facts
   already **are** analytics events by query time. The correlation was denormalized
   onto the write path. If RC stops writing there, all four attribution queries
   return empty and `rc-summary`'s event-derived half dies with them.
2. **RC writes `$rc_*` props into analytics `user_profiles` via the shared
   `ProfileWriter`** (`rc-webhook.processor.ts:137`, `rc-backfill.service.ts:27`).
   `profile-writer.ts:81` is read-fold-write over a whole row, so SDK props and
   `$rc_*` props contend for one `(project_id, distinct_id)` row under
   last-write-wins. Verified as **costly, not blocking** — but it is a data-model
   problem, not a transport one, and the backfill path needs a *batch* write API,
   not a per-profile one.
3. **Identity resolution reads analytics data on every webhook.**
   `rc-identity.service.ts:14` queries `$rc_link` events, `identity_mappings`, and a
   raw `distinct_id` probe. Mandatory path, not enrichment. The existing `unlinked`
   journal status + `replayUnlinked` already model resolution failing and retrying,
   so the *semantics* survive a network hop — but it becomes one on every webhook.
4. **`RcAttributionService` imports analytics query-building internals**
   (`analytics/support/identity.ts`) as source, not as a contract.

Explicitly **not** blockers (verified and downgraded from the first pass):

- **Profile filters over `$rc_*` are fine.** `filter-compiler.ts:125` compiles
  `distinct_id IN (SELECT ... FROM user_profiles FINAL ...)` — but `user_profiles`
  is a generic, RC-agnostic analytics table that predates RC and has other writers.
  The `$rc_*` data analytics reads is a *projection*, not RC's authoritative store.
  It stays co-located; only the write path moves.
- **FK cascades** to `projects` — mechanical (an outbox/event on project deletion).
- **Auto-cohort seeding, `ProblemException`, shared Prisma/contracts types,
  `assertMembership`** — all minor.

**So the split decouples the datastores but not the data flow.** A separate RC
service still needs a published ingestion boundary into analytics (single + batch
profile ops, event insert) and an identity-resolution API. That is exactly why
*shared databases* was chosen: it keeps the write path in-process and defers this
entire problem, while still buying an independent deploy unit.

Prerequisites that spec must address:

- **No deployment exists.** Zero Dockerfiles, no registry, no pipeline; `infra/` is
  a local-dev compose running databases only. Most of "add a second service" is
  first-service work.
- **JWTs are HS256 — a symmetric shared secret.** A second service that verifies
  tokens holds the secret that *mints* them. Moving to asymmetric signing is a
  contained change (`TokenService` is the only signer, `JwtAuthGuard` the only
  verifier) and should precede a real split.
- **Roles are not in the token.** Every authorization decision reads `memberships` /
  `project_memberships` / `projects.org_id` from Postgres. Extract
  `ProjectRoleResolverService` into a shared package rather than copying it — the
  org-owner derivation is already duplicated between the guard's resolver and
  `assertMembership`, and a third copy will drift.
- **Port inconsistency to reconcile first:** README says 8080, `app-config.ts`
  defaults to 8088, `dev.sh`/`vite.config.ts` proxy to 8088, the infra design pins
  Cloud Run to 8080.

**Database choice:** no new datastore. Postgres for mutable subscription state and
ClickHouse for the event journal is already correctly matched to the workload, and
subscription data is tiny next to analytics events — the cost is in the events
table either way. If the RC service is to own its data boundary, the cheap and
reversible move is its own Postgres *schema* on the existing instance, not a
separate database.

## Follow-ups (out of scope)

- Reconcile or explain the Revenue / Overview discrepancy in-UI.
- `nav-model.ts` drifting from `router.tsx` — no automatic link.
- `NAV_SHORTCUT_LETTERS` silently dropping renamed labels.
- Build the six placeholder RC pages.
