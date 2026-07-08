# Feature 15 — Event Catalog / Data Dictionary

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend) — localStorage descriptions

## 1. What it is
A searchable catalog of every event the project tracks: name, volume, whether it's autocaptured (`$`)
or manual, its properties, and an editable **description** so a growing team shares one "what does this
event mean" reference. The data dictionary product analytics teams always end up needing.

## 2. Why
- As event count grows, "what is `checkout_step_2`?" becomes a real question. A catalog answers it.
- Composes existing metadata (`meta/events`, `meta/properties`, `events/summary` counts); descriptions
  live in localStorage now (promotable to shared later).

## 3. Design — an Event Catalog page
Route `/projects/$projectId/events` (or `/catalog`) + nav link (mirror Distributions/Properties wiring).
- Data: `useMetaEvents(projectId)` (all event names, last 30d) + `useEventSummary(projectId)`
  (`by_event` counts, all-time) joined by name → each event's total volume. Autocaptured vs manual is
  determined by the `$` prefix (contracts §4). A search box filters by name; sort by name or volume.
- A `DataTable` (or list) of events: name (with a "$ auto" / "manual" badge), volume, a
  short description (editable inline or via an edit affordance), and an expander → the event's
  **properties** (`useMetaProperties(projectId)` filtered to that event via `?event=` — call
  per-expanded-event, or fetch all once and group; prefer lazy per-event to avoid N calls up front)
  with each property's type. CSV-exportable (feature D).
- **Descriptions store** `useEventDescriptions(projectId)` (localStorage `myampix:eventdescs:<projectId>`):
  `get(event)`, `set(event, text)`, corrupt/absent → empty, per-project. Edit inline (a small
  textarea/Input + save), optimistic.
- A summary `KpiTile` row: total distinct events, # autocaptured, # manual, total event volume.

## 4. States & edge cases
- Events in `meta/events` with no `by_event` count (seen in last 30d but 0 all-time? unlikely) → show 0 /
  "—". Events in `by_event` but not `meta/events` (older than 30d) → still list them (union the two
  sources by name).
- Description edit for an event with no data yet → allowed (documenting ahead of data).
- Corrupt localStorage → empty descriptions, never crash.
- Property fetch per event is lazy (on expand) and cached by React Query.
- Accessibility: the table + expanders are keyboard-accessible; edit fields are labelled.

## 5. Testing
- `event-descriptions.test.ts`: get/set/persist per project, corrupt→empty.
- `event-catalog.test.tsx`: renders events with volume + auto/manual badge from the meta/summary
  fixtures; search filters; expanding an event shows its properties; editing a description persists
  (assert localStorage or a re-render shows it); summary counts.

## 6. Tasks
- T1: `event-descriptions.ts` (+test) + `EventCatalogPage.tsx` (+test) composing meta/events + summary +
  per-event properties + editable descriptions + summary; route + nav (+ NavIcon). (One commit.)

## 7. Later (needs backend)
- Per-event first/last seen + property value stats (needs a small metadata query with min/max
  timestamp per event). Shared team descriptions via a backend table. Deprecation flags / PII tags.
