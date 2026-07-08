# Feature 13 — Favorites & Recents

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend, localStorage)

## 1. What it is
Star the reports, dashboards, users, and cohorts you care about, and get an automatic "recently viewed"
list. Both surface on Home and at the top of the command palette so the things you use are one click
away. Stored per project in the browser.

## 2. Why
- Analytics teams return to the same handful of reports/dashboards constantly; favorites + recents kill
  the hunt.
- Composes with the command palette (feature SF-1) and Home.

## 3. Design
- A shared entity ref: `FavItem = { type: 'report'|'dashboard'|'user'|'cohort'; id: string; name: string }`.
- `useFavorites(projectId)` (localStorage `myampix:favorites:<projectId>`): `list`, `isFavorite(type,id)`,
  `toggle(item)`. `useRecents(projectId)` (localStorage `myampix:recents:<projectId>`): `list`,
  `record(item)` — unshift, dedupe by type+id, cap to ~15, most-recent first. Both guarded against
  corrupt storage → empty; per-project keyed. Deterministic (no Math.random).
- **Star toggle** `FavoriteButton` (a star icon button, `aria-pressed`, accessible name "Favorite <name>")
  added to: report cards/rows (ReportsPage), dashboard cards (DashboardsPage), the user profile header,
  and cohort rows (CohortsPage). Clicking toggles favorite without navigating.
- **Record recents** on detail visits: call `record(...)` on mount of `ReportDetailPage`,
  `DashboardViewPage`, `UserProfilePage` (and when opening a cohort for edit) with the entity's
  type/id/name.
- **Home**: a "Favorites" section (grouped or a flat list of `FavItem` links, with unstar) and a
  "Recently viewed" section — both empty-stated. Place near the existing recent reports/dashboards (can
  replace/augment those).
- **Command palette**: when the query is empty, show Favorites then Recents at the top (above Pages) for
  instant access; they navigate to the entity.
- Icons from the icon set (`IconStar` — add a filled/outline star if not present).

## 4. States & edge cases
- A favorited/recent entity that was deleted → clicking it 404s gracefully (or prune on load if cheap);
  don't crash. Keep it simple: navigate and let the detail page's not-found handle it; offer unstar.
- Corrupt/absent storage → empty lists.
- Per-project isolation; switching projects shows that project's favorites/recents.
- Recents cap + dedupe (revisiting moves it to top, doesn't duplicate).
- Accessibility: star buttons are real buttons with `aria-pressed`; lists are navigable.

## 5. Testing
- `favorites.test.ts` / `recents.test.ts`: toggle/isFavorite, record dedupe+cap+order, per-project,
  corrupt→empty.
- `FavoriteButton` test: toggles + aria-pressed, doesn't navigate.
- A Home test: favoriting a report shows it in the Favorites section; visiting a report records it in
  Recents (or a focused unit test of `record`).
- Palette test: empty query shows favorites/recents entries.

## 6. Tasks
- T1: `favorites.ts` + `recents.ts` (+tests) + `FavoriteButton` (+test); wire stars on Reports,
  Dashboards, user profile, Cohorts; record recents on the three detail pages; Home Favorites + Recents
  sections; palette favorites/recents. Tests. (One commit — or split Home/palette into T2 if large.)

## 7. Later
- Cross-project "pinned" items; team-shared favorites (backend); reorderable favorites.
