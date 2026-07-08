# Feature 16 — Dashboard Presentation / TV Mode

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend)

## 1. What it is
A fullscreen, chrome-free, auto-refreshing view of a dashboard for wall displays and standups. Hit
"Present" and the board fills the screen — big tiles, a clock, a "last updated" stamp, data refreshing
on an interval — no sidebar, no builder. Optionally cycles through tiles one at a time for a small
screen.

## 2. Why
- Dashboards are built to be *watched*; a TV/standup mode is the payoff for a 100k-MAU team's ops wall.
- Reuses the existing dashboard tile rendering + the fullscreen-overlay pattern already shipped for the
  paths map.

## 3. Design
- On `DashboardViewPage`, a **Present** button opens a `fixed inset-0 z-50` overlay
  (`role="dialog" aria-modal`, focus-managed, Esc to exit — mirror the PathMap fullscreen from feature
  T5).
- The overlay renders the dashboard's tiles large (reuse `DashboardGrid`/the tile-rendering component
  in a bigger layout; hide edit affordances) on the app background, with a header strip: dashboard name,
  a live **clock**, a **"Updated HH:MM:SS"** stamp, and controls (Refresh interval select
  15s/30s/60s/off, a Cycle toggle, Exit).
- **Auto-refresh**: re-fetch the dashboard data (`useDashboardData` refetch, or set its
  `refetchInterval`) on the chosen interval; update the stamp. Pause when interval = off.
- **Cycle mode** (optional/nice): when on, show ONE tile at a time full-bleed, advancing every ~10s,
  with dots/pager; off = the full grid. Keep the grid mode as the default.
- **Body scroll lock** while presenting; **wake-friendly** (no modal that blocks — it IS the modal).
- Restore focus to the Present button on exit.

## 4. States & edge cases
- Empty dashboard (no tiles) → a friendly "No tiles yet" fullscreen state.
- A tile that errors → its cell shows the error inline (as the grid already does), doesn't break the
  wall.
- Interval = off → no polling; a manual Refresh button still works.
- Reduced motion → cycle transitions are instant (no slide).
- Resize/orientation → the grid reflows responsively.
- Accessibility: the overlay is a labelled dialog; controls are reachable; the clock is `aria-hidden`
  (decorative) but the "updated" stamp is announced politely on refresh (or kept quiet to avoid noise —
  prefer quiet, it's a wall display).

## 5. Testing
- A DashboardViewPage test: clicking Present opens the `role=dialog` overlay showing the dashboard name
  + tiles; the refresh-interval control is present; Esc closes it and focus returns to the trigger.
  (Timer-based auto-refresh can be asserted with fake timers or just that `refetchInterval`/refetch is
  wired — keep it robust in jsdom.)
- Cycle toggle (if built): shows one tile + a pager.

## 6. Tasks
- T1: `PresentationMode.tsx` (+ wire the Present button + overlay on DashboardViewPage) with grid mode +
  auto-refresh + clock/stamp + Esc/exit + focus mgmt; cycle mode if clean. Tests. (One commit.)

## 7. Later
- Shareable "present" URL (kiosk link — bridges to the future dashboard-sharing feature); per-tile
  full-bleed rotation timing; dark-by-default TV theme.
