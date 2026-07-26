# dashboard — MyAmpix admin interface

The React SPA that fronts both MyAmpix products. It talks to **two** backends: `mobile_analytics`
(MyAmplitude) and `mobile_purchase` (MyRevenueCat). One login, one shell, two tool groups.

- **Package:** `@myampix/dashboard`
- **Dev port:** `5173` (Vite); production ships a static build behind a reverse proxy
- **Stack:** React 18 + TypeScript, TanStack Router + Query, Radix UI, Tailwind, Vite
- **Tests:** Vitest + MSW (component/integration), Playwright (e2e)
- **Repo-wide context:** see the root [`DOCUMENTATION.md`](../DOCUMENTATION.md)

---

## How to run

From the **repo root** (pnpm workspace):

```bash
corepack enable && pnpm install
pnpm --filter @myampix/dashboard dev        # → http://localhost:5173
```

You need the backends running for real data:

- `mobile_analytics` on `:8088` — the Vite dev server proxies `/api` and `/ingest` to it.
- `mobile_purchase` on `:8090` — for the MyRevenueCat pages (see its README).

The fastest path to analytics + dashboard together is `pnpm dev` from the repo root; start
`mobile_purchase` separately when working on billing pages.

### Package scripts

| Script          | What it does                                        |
| --------------- | -------------------------------------------------- |
| `dev`           | Vite dev server on `:5173`                          |
| `build`         | `tsc --noEmit` + Vite production build              |
| `preview`       | serve the production build locally                  |
| `verify:build`  | build + `scripts/verify-build.sh` checks            |
| `typecheck`     | `tsc --noEmit`                                       |
| `lint`          | ESLint                                              |
| `test`          | `vitest run`                                        |
| `test:watch`    | `vitest` watch mode                                 |
| `test:coverage` | coverage run (floor **75%**)                        |
| `e2e`           | Playwright end-to-end tests                          |

---

## Runtime configuration

The app reads `window.___MYAMPIX_CONFIG__` from [`public/config.js`](public/config.js), which loads
*before* the bundle and is **replaced at deploy time** — so one static build runs against any
backend origins without rebuilding.

```js
window.___MYAMPIX_CONFIG__ = {
  apiBaseUrl: '',                              // '' = same origin (Vite proxy in dev / reverse proxy in prod)
  purchaseApiBaseUrl: 'http://localhost:8090', // mobile_purchase origin (a DISTINCT backend)
};
```

`getRuntimeConfig()` merges these over defaults (`{ apiBaseUrl: '', purchaseApiBaseUrl: '' }`):

- `apiBaseUrl` → `mobile_analytics`. Empty in dev because Vite proxies `/api` + `/ingest`.
- `purchaseApiBaseUrl` → `mobile_purchase`. Must be an **absolute** origin in dev, since both
  backends expose `/api/v1/projects/:id/…` and cannot share an origin.

---

## What's inside

Navigation is split into two tool groups:

- **MyAmplitude** — Home, Insights, Funnels, Retention, User paths, Heatmaps, Cohorts, Dashboards. Reads `mobile_analytics`.
- **MyRevenueCat** — Overview, Conversion, Customers, Products, Offerings, Entitlements, Settings. Reads `mobile_purchase` directly. These pages are always visible (no "connect RevenueCat" gate); the only load gate is the project list resolving. Settings hosts the per-app **Connect Stores** flow (Google Play + App Store credentials).

Feature code lives under `src/features/*` (e.g. `analytics/`, `revenuecat/`, `projects/`); shared
UI under `src/components/`; the app shell + navigation model under `src/components/layout/`.

---

## Testing notes

- **Vitest + MSW.** Prefer testing via role/text. Run one file at a time while iterating —
  Radix `Select` interactions can hang under jsdom, so avoid driving native-select-like popovers in tests.
- Coverage floor is **75%** (CI-enforced).
- **Playwright** covers end-to-end flows (`pnpm --filter @myampix/dashboard e2e`).

```bash
pnpm --filter @myampix/dashboard test src/features/revenuecat/…   # single file/dir
```
