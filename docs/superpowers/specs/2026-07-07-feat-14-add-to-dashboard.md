# Feature 14 — Add to Dashboard (from any chart / report)

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend) — reuses tile API

## 1. What it is
An **Add to dashboard** button on charts and saved reports: pick a dashboard (or create one) and the
current analysis becomes a tile on it in one click. Closes the loop between exploring and pinning —
no copy-pasting a query into the dashboard builder.

## 2. Why
- Today you build an analysis, then separately rebuild it as a dashboard tile. This makes "I want to
  keep watching this" one click.
- Reuses the existing tile API (`useCreateTile`, `CreateTileRequest = { title, kind, saved_report_id?,
  inline_definition?, x, y, w, h }`) — no backend.

## 3. Design
- `AddToDashboardButton.tsx`: a button that opens a popover/dialog:
  - a **dashboard picker** (from `useDashboards`) + an inline "＋ New dashboard" (create via
    `useCreateDashboard`, then use its id),
  - a **title** input (prefilled from the analysis, editable),
  - a **Add** action that calls `useCreateTile(projectId, dashboardId).mutate(request)` and toasts
    "Added to <dashboard>" with a link to it.
  - Props: `{ projectId, draft: { kind: ReportKind; title: string } & ({ savedReportId: string } | { inlineDefinition: AnalysisDefinition }) }` — the caller supplies either a saved-report reference OR an inline definition + kind.
  - Position/size: append at the bottom of the target dashboard — compute `y` = max existing tile
    `y+h` (fetch the dashboard's tiles via `useDashboard` when a target is chosen) or a safe large `y`;
    default `w:6, h:4, x:0, position: nextPosition`. The dashboard grid reflows on open, so a sensible
    append is enough.
- Wire it on:
  - **Insights** (and Funnels/Retention/Flows if clean) — build an `inline_definition` from the current
    builder state + the page's `kind` ('insights'|'funnel'|'retention'|'flows'); the button sits near
    the chart/Run action. Only enabled once a query has been run / is valid.
  - **Reports** — on a report row/detail, add via `saved_report_id` (a tile that references the saved
    report). Reuse the same button with the `savedReportId` draft variant.

## 4. States & edge cases
- No dashboards yet → the picker shows only "＋ New dashboard" (create-then-add flow).
- Creating the tile fails → error toast, dialog stays open.
- The analysis isn't runnable yet (Insights with no events) → button disabled with a hint.
- Duplicate add (same report twice) → allowed (dashboards can hold duplicates); no special handling.
- The inline definition must match the backend tile schema for its `kind`; build it from the SAME shape
  the page already sends to its run endpoint (reuse that object).
- Accessibility: dialog focus-trapped; the button has a clear accessible name.

## 5. Testing
- `AddToDashboardButton` test: opening it lists dashboards; choosing one + Add calls `useCreateTile`
  with the expected request (title, kind, inline_definition/saved_report_id) via msw; "New dashboard"
  path creates then adds; error toast on failure.
- An Insights test: the Add-to-dashboard button builds an insights `inline_definition` tile request.

## 6. Tasks
- T1: `AddToDashboardButton.tsx` (+test) + wire Insights (inline definition) + Reports (saved_report_id).
  msw handlers for tile create already exist (dashboards tests) — extend if needed. (One commit.)

## 7. Later
- Add-to-dashboard from Funnels/Retention/Flows/Revenue/Distributions; choose tile size on add;
  "pin to a new dashboard named after the analysis".
