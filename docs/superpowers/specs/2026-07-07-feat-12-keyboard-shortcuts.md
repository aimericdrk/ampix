# Feature 12 — Keyboard Shortcuts + Help Overlay

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend)

## 1. What it is
Power-user keyboard navigation: `g` then a letter jumps to a page (`g h` Home, `g i` Insights, `g f`
Funnels, `g r` Reports, `g u` Users, `g d` Dashboards, `g v` Revenue…), `?` opens a help overlay
listing every shortcut, and `/` / ⌘K open the command palette (already built). Fast movement without
the mouse, discoverable via `?`.

## 2. Why
- Complements the command palette for the destinations you hit constantly.
- `?` overlay makes the whole shortcut system self-documenting.

## 3. Design
- `useKeyboardShortcuts()` mounted once in `AppLayout` (project scope, has `projectId` + `useNavigate`):
  a global `keydown` listener that:
  - **Ignores** events when the target is an input/textarea/select/contenteditable or a modifier
    (ctrl/meta/alt) is held (so it never hijacks typing or ⌘K).
  - Implements a `g`-prefixed sequence: pressing `g` arms a short (~1.2s) window; the next letter runs
    the mapped navigation, else the arm expires. Map letters → routes derived from the shared
    `nav-model.ts` (single source of truth) so shortcuts and the sidebar/palette stay aligned (assign a
    stable letter per nav item; keep the map in one place).
  - `?` (shift+/) toggles the **ShortcutsHelp** overlay. `Escape` closes it.
  - `/` opens the command palette (dispatch the same open mechanism the palette uses, or focus its
    trigger) — coordinate with the existing palette so there's one open path.
- `ShortcutsHelp.tsx`: a `role="dialog" aria-modal` overlay (reuse the dialog primitive) listing
  grouped shortcuts (Navigation: the `g` combos; General: `?` help, `⌘K`/`/` palette, `Esc` close),
  rendered as `<kbd>` chips. Focus-trapped; Esc/backdrop closes; focus restored to the opener.
- A subtle "Press ? for shortcuts" hint somewhere unobtrusive (e.g. footer or the palette).

## 4. States & edge cases
- Typing in a field → shortcuts inert (the input guard).
- `g` then an unmapped key → no-op, arm clears.
- Overlay open → `g` sequences disabled until closed (or still work — pick: disabled while a dialog is
  open to avoid surprise navigation).
- Rapid `g x` vs slow `g … x` → the arm timeout handles it; a second `g` re-arms.
- Reduced motion respected for the overlay transition.
- SSR/no-window guard (there is no SSR here, but guard `window` for tests).

## 5. Testing
- `useKeyboardShortcuts`/AppLayout test: pressing `g` then `i` navigates to Insights (assert route or
  navigate mock); pressing a shortcut while focused in an input does NOT navigate; `?` opens the help
  overlay and `Esc` closes it; the overlay lists the shortcuts.
- Ensure existing AppLayout/render-app tests still pass (the global listener must not interfere).

## 6. Tasks
- T1: `keyboard-shortcuts.ts` (`useKeyboardShortcuts` + the letter→route map derived from nav-model) +
  `ShortcutsHelp.tsx` + mount in AppLayout + the `?` hint. Tests. (One commit.)

## 7. Later
- User-customizable bindings; `j/k` list navigation; sequence for "new report/cohort".
