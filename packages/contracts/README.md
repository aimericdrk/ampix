# @myampix/contracts — shared contracts

Shared **Zod schemas + TypeScript types** for MyAmpix: ingest payloads, query definitions, and API
DTOs. It is the single source of truth for the shapes that cross the SDK ↔ backend ↔ dashboard
boundaries, so a change here ripples to every consumer — read it before touching any cross-service
interface.

- **Package:** `@myampix/contracts` (consumed as `workspace:*`)
- **Consumers:** `mobile_analytics` (and, indirectly, the SDKs/dashboard via matching shapes)
- **Design reference:** `docs/superpowers/specs/2026-07-02-shared-contracts.md`
- **Repo-wide context:** root [`DOCUMENTATION.md`](../../DOCUMENTATION.md)

## Layout

- `src/index.ts` — public barrel (import from `@myampix/contracts`).
- `src/ingest.ts` — ingest event/profile payload schemas + types.

## Scripts

```bash
pnpm --filter @myampix/contracts build       # tsc → dist/ (runs on install via prepare)
pnpm --filter @myampix/contracts test        # Jest
pnpm --filter @myampix/contracts typecheck   # tsc --noEmit
```

Because this package is built into `dist/` and imported by others, run `build` (or reinstall) after
changing a schema so consumers pick up the new types.
