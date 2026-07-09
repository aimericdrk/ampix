# Feature 18 — Installations World Map + by-Country / by-OS (Home)

Date: 2026-07-08 · Status: spec ready · Surface: dashboard (frontend only) — from-scratch choropleth, no map lib

## 1. What it is
On the Home page, an **Installations** section:
1. An **interactive world choropleth** — every country shaded by installation volume (darker = more
   installs), hover (or keyboard-focus) a country to see its name + install count in a tooltip.
2. **Installations by country** — a ranked, sortable list/table beside the map.
3. **Installations by OS** — a breakdown bar chart.
All time-scoped by the global date range + global filters.

"Installation" = the `$first_open` event (fired once per install). Country comes from a **`country`
property the app sets via the SDK** (`MyAmpix.instance.registerSuperProperties({'country': 'US'})`),
so every event — including `$first_open` — carries it. The map is built **from scratch** (own SVG
projection + rendering + interaction), using bundled public-domain geometry — no map library.

## 2. Bundled data assets (already added)
- `dashboard/src/features/analytics/geo/world-countries.geo.json` — 180 country features, each `id` =
  ISO-3 code (e.g. `USA`), `properties.name`, `geometry` Polygon | MultiPolygon (lon/lat rings).
  (Some ids are `-99`/unknown for disputed areas — render them as no-data, never crash.)
- `dashboard/src/features/analytics/geo/country-codes.ts` — `toIso3(value)` resolves an SDK country
  value (ISO-2 `US`, ISO-3 `USA`, or a name `United States`) → ISO-3 or null; `iso3Name(iso3)` → name.

## 3. Design

### 3.1 Projection + path (pure, tested) — `geo/projection.ts`
- `project(lon, lat, w, h): [number, number]` — **equirectangular**: `x = (lon + 180) / 360 * w`,
  `y = (90 - lat) / 180 * h`. Deterministic, no deps.
- `featurePath(feature, w, h): string` — convert a GeoJSON `Polygon`/`MultiPolygon` into one SVG path
  `d` string: for each ring, `M x0 y0 L x1 y1 … Z` (project every [lon,lat] coord). Round to ~2dp to
  keep the path compact. Handle both geometry types + empty/degenerate rings.
- Choose a viewBox, e.g. `1000 × 500` (2:1 equirectangular). Unit-test: a known lon/lat projects to the
  expected x/y; a small square Polygon yields a closed `M…L…L…L…Z` path; MultiPolygon concatenates rings.

### 3.2 Colour scale (reuse palette)
- Reuse the existing sequential ramp: `SEQUENTIAL_BLUE_RAMP` / `sequentialColor(t)` from `palette.ts`
  (already theme-aware, dataviz-validated). Map a country's value → `t` in [0,1]. Use a **sqrt (or
  log1p) scale** by default so a few huge countries don't flatten everyone else:
  `t = Math.sqrt(value) / Math.sqrt(max)` (guard max 0 → all 0). No-data countries get a muted
  `--border`/`--chart-surface`-ish fill, visually distinct from "0 installs".
- A **legend**: a horizontal gradient bar 0→max with min/max labels + a separate "no data" swatch.

### 3.3 `components/charts/WorldChoropleth.tsx`
- Props: `{ data: Record<string, number> /* ISO-3 → value */, ariaLabel: string, valueLabel?: string /* e.g. "installs" */, height?: number, onSelectCountry?: (iso3: string) => void }`.
- Renders an SVG (`role="img"`, `aria-label`, `viewBox`, `width:100%`, responsive; `preserveAspectRatio`).
  One `<path>` per feature, `fill` from the scale (or no-data), thin `--border` stroke.
- **Interactivity**: each country path is hoverable AND keyboard-focusable (`tabIndex={0}`, an
  `aria-label` like `"United States: 1,234 installs"`). On hover/focus: raise it (thicker stroke /
  slight opacity), and show a **tooltip** — a positioned `div` (follow the pointer, or anchor near the
  country) with the country name + `formatExactNumber(value)` + valueLabel; "No data" when the country
  isn't in `data`. Tooltip hides on leave/blur. Respect reduced motion.
- Optional `onSelectCountry` → clicking a country calls it (Home can wire this to drill into a global
  `country` filter later — leave it optional/unwired for v1 unless trivial).
- Ships the standard **accessible data table** (country name, value, share %) below/adjacent, like the
  other charts — so it's not mouse-only.
- Pretty: subtle drop of the graticule optional; clean borders; hover lift; the ocean/background uses
  `--chart-surface`. Must look good in light AND dark (use tokens only).
- Unit/interaction test: renders paths for countries in `data`; a country with a value has its
  `aria-label`/table row with the formatted value; hovering/focusing shows the tooltip; no-data
  countries render but read "No data".

### 3.4 Data — Home wiring
- Add `useInstallsByCountry` + `useInstallsByOs` (or reuse `useInsightsQuery` inline) building the query:
  `{ events: [{ name: '$first_open', aggregation: 'total' }], date_range: {from,to}, interval, filters: mergeGlobalFilters([], globalFilters), breakdown: { property: 'country' /* or 'os' */ } }`.
- From the response: each breakdown series' `sumSeries` = that value's install count. For the map:
  fold each breakdown value through `toIso3()` (aggregating values that resolve to the same ISO-3;
  drop/aggregate unresolved into an "Unknown" bucket shown in the list but not on the map) → `Record<iso3, count>`.
  For the by-country list: sorted desc with names via `iso3Name`, + an "Unknown" row for unresolved.
- Add an **Installations section** to `HomePage.tsx` (a `ChartCard`s block, near the top or after the
  KPI row): the `WorldChoropleth` (prominent, full width) titled "Installations by country" + the
  by-country `DataTable` (country, installs, share, `exportFilename="installs-by-country"`) + the
  `BreakdownChart` "Installations by OS". Time-scoped by `useDateRange` + global filters.
- **Empty state** (no `$first_open` events, or none carry a `country`): a friendly card — "No
  installations with a country yet. Set a `country` super property in your app
  (`MyAmpix.instance.registerSuperProperties({'country': 'US'})`) so installs appear on the map." Also
  show it when `$first_open` exists but every country is Unknown.

## 4. Edge cases
- Country value the SDK sends that `toIso3` can't resolve → counted under "Unknown" (listed, not mapped).
- ISO-3 in data with no geometry feature (e.g. tiny states) → shown in the list, absent from the map.
- Geometry feature id `-99`/unknown → rendered as no-data, never matched.
- Huge skew (one country dominates) → sqrt/log scale keeps smaller countries legible.
- Global filter on `country` already active → the map still shows the (now-filtered) distribution.
- Performance: 180 features × projected paths is fine as static SVG; memoize the projected paths (they
  don't depend on `data`, only on size) — recompute only the fills when `data` changes.
- Accessibility: keyboard nav across countries; tooltip content mirrored in the data table.

## 5. Testing
- `projection.test.ts`: `project` known points; `featurePath` Polygon + MultiPolygon shape.
- `world-choropleth.test.tsx`: renders country paths; a data country's row/aria shows its formatted
  value; no-data country reads "No data"; the legend renders.
- Home test: the Installations section runs a `$first_open` breakdown-by-country query (assert the
  posted body) and renders the map + by-country table + by-OS chart; empty state when no data.

## 6. Tasks
- T1: `geo/projection.ts` (+test) + `WorldChoropleth.tsx` (+test) using the bundled geometry + palette.
- T2: Home Installations section (map + by-country table + by-OS chart) + data wiring + empty state +
  tests. Commit assets + code together.

## 7. Later
- Click-to-drill (country → global `country` filter); zoom/pan; region grouping; real geo-IP as an
  alternative source; a dedicated Geography page reusing the choropleth.
