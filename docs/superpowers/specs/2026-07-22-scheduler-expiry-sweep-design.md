# MyRevenueCat — Scheduler skeleton + subscription-expiry sweep (D2) — Design

**Goal:** Give `backend/mobile_purchase` its first time-driven capability (roadmap X2's skeleton): a `@nestjs/schedule`-based scheduler running one job — a **subscription-expiry sweep** that flips still-entitled-looking subscriptions to `EXPIRED` once their expiry instant passes, **through the existing lifecycle reducer**, so DB state, metrics, and customer counts stay honest without waiting on a store webhook.

**Design principle:** Do EXACTLY what RevenueCat does. RC detects expirations server-side and promptly — its charts report `expiration` churn and its customer state flips without depending on store-notification timing. Today our only writer of `status = 'EXPIRED'` is the webhook path (`subscription-lifecycle-reducer.ts` `EXPIRED` case, fed by Apple/Google mappers) — if the store's notification is late or lost, a subscription stays `ACTIVE` forever in the DB. The entitlement surface is already immune (compute-on-read checks `expiresAt`, `compute-customer-info.ts:68-70`), but raw-status readers are not: the customers-list `activeSubscriptionCount` (`customers-query.service.ts:64-69`, no expiry predicate) inflates forever, `trials_converted` (`summary.service.ts:83-93`, no expiry predicate) overcounts, and the churn `status:'EXPIRED'` branch (`summary.service.ts:164`) only fires when a webhook happens to arrive.

**This is D2 of sub-project D's three creds-free slices** (D1 Refund ✅, D2 this, D3 Cloud Run image slimming), each its own spec → plan → SDD.

---

## §0. Constraints & principles

- **One writer of subscription state.** The sweep does NOT bulk-`updateMany` a status. It synthesizes an `EXPIRED` lifecycle event per candidate row and applies it via the SAME reducer + persist path the webhooks use — preserving `lastEventAt` semantics and the reducer's ordering guard, so a late store webhook still supersedes cleanly. (User-locked decision.)
- **No store-notification journal writes.** `StoreNotification` journals store deliveries; a sweep transition is internally originated. State transition only.
- **Sweep never touches:** `BILLING_RETRY` (not entitled already; the store is still retrying and will send the resolving webhook), `PAUSED` (Google will resume/expire it via RTDN), `EXPIRED`/`REVOKED` (terminal), and any candidate-status row with a `null` effective expiry (never auto-expire lifetime/unknown).
- **Idempotent + safe under concurrency.** A re-run finds nothing new; overlapping runs (same instance or a future second Cloud Run instance) are excluded by a Postgres advisory try-lock — skip-and-log, never queue.
- **Additive only.** No schema/migration change (`expiresAt`, `gracePeriodExpiresAt`, `SubscriptionStatus` all exist). `mobile_analytics` untouched. No changes to webhook ingest, refund, or metrics code.
- **HARD WIP rule** (always in force): never touch the user's uncommitted collapse-rail WIP (`dashboard/src/components/layout/*`, `nav-model.ts`, `CommandPalette.tsx`, `render-app.tsx`, `RailInitial.tsx`, `demo_config.dart`). Never commit `.env`/secrets. No co-author trailers. The user merges.

## §1. Scheduler infrastructure (`src/scheduler/`)

- **Dependency:** add `@nestjs/schedule` (the NestJS-canonical cron; no new infra).
- **`SchedulerModule`** — imports `ScheduleModule.forRoot()` and registers the job class(es). Wired into `AppModule`. Owns *when*, not *what*: job classes here are thin cron bindings that delegate to domain services.
- **Config (Zod, in the existing `AppConfigModule` schema):**
  - `SCHEDULER_ENABLED` — boolean, default `true`. When `false`, the cron binding registers nothing (clean opt-out for tests and future split workers).
  - `EXPIRY_SWEEP_CRON` — cron expression string, default `*/5 * * * *` (every 5 minutes; RC-faithful promptness without load).
- **`ExpirySweepJob`** (in `src/scheduler/`) — the `@Cron` handler: checks the enabled flag, calls `SubscriptionExpirySweepService.sweep(nowMs)`, catches EVERYTHING (a job must never throw out of the handler), logs one summary line per run (`candidates`, `expired`, `skippedLock`, `durationMs`) — debug-level when the run was a no-op.
- **Concurrency guard:** each sweep batch runs inside a `prisma.$transaction` whose first statement is `SELECT pg_try_advisory_xact_lock(<EXPIRY_SWEEP_LOCK_KEY>)` (a fixed application-chosen bigint constant). `false` → another holder is sweeping → end the pass (`skippedLock`), no retry, no queueing. Xact-scoped locking avoids pinning a pooled connection.

## §2. `SubscriptionExpirySweepService.sweep(nowMs)` (`src/subscriptions/`, beside the lifecycle code)

1. **Candidate predicate** (effective expiry ≤ now):
   - `status ∈ { TRIAL, INTRO, ACTIVE, CANCELLED }` AND `expiresAt ≠ null` AND `expiresAt ≤ now`, OR
   - `status = GRACE_PERIOD` AND (`gracePeriodExpiresAt ≠ null` AND `gracePeriodExpiresAt ≤ now`, OR `gracePeriodExpiresAt = null` AND `expiresAt ≠ null` AND `expiresAt ≤ now`).
   - Everything else untouched (§0).
2. **Batching:** load candidates `take BATCH_SIZE` (500) per transaction, loop until a batch comes back empty, capped at `MAX_BATCHES_PER_RUN` (20) — if capped, log it (the next cron tick continues; no unbounded runs).
3. **Per row (inside the batch transaction):** synthesize the `EXPIRED` lifecycle event with `occurredAt` = the row's **own effective expiry instant** (`gracePeriodExpiresAt` for grace rows, else `expiresAt`) — NOT `now`. Apply it through the existing reducer/persist seam (`applySubscriptionLifecycle` in `src/webhooks/shared/persist-lifecycle-event.ts`, or the closest exported equivalent — the plan pins the exact signature and, if the seam is webhook-shaped, extracts the minimal reusable core rather than duplicating reducer logic). Using the expiry instant as `occurredAt` means the reducer's ordering guard keeps working exactly as for webhooks: any later real store event (renewal that raced in, revoke, etc.) supersedes, and if a later event already landed, the sweep's event no-ops.
4. **Row-level failure:** log and continue with the rest of the batch; the next pass retries naturally.
5. **Determinism:** `nowMs` is a parameter (injected clock, like `RefundService`/metrics) — the cron passes `Date.now()`, specs pass a fixed instant.

## §3. Effects on the known stale readers (no reader code changes)

- The churn `status:'EXPIRED'` branch (`summary.service.ts:164`) now fires within one sweep interval instead of depending on webhook timing — `churn_reasons.expiration` becomes trustworthy.
- The customers-list `activeSubscriptionCount` and `trials_converted` overcounts self-heal within one interval (staleness now bounded by `EXPIRY_SWEEP_CRON`).
- Making those two readers expiry-aware themselves is an **optional follow-up**, not D2 (the sweep bounds the error; adding predicates would change tested query shapes for marginal gain).

## §4. Testing

- **Sweep service (Testcontainers):** the status × expiry matrix — each candidate status with expiry past/future/null flips only when it should; `GRACE_PERIOD` honors `gracePeriodExpiresAt` incl. the null-fallback-to-`expiresAt` arm; `BILLING_RETRY`/`PAUSED`/`EXPIRED`/`REVOKED` rows with past dates stay untouched; `occurredAt`/`lastEventAt` equals the expiry instant; a row whose `lastEventAt` is already later than its expiry instant is not clobbered (ordering-guard supersede); batch loop drains > BATCH_SIZE candidates; re-run is a no-op; `computeCustomerInfo` on a swept customer stays not-entitled (consistency proof).
- **Lock guard:** with the advisory lock held by a competing connection, `sweep` returns `skippedLock` and writes nothing.
- **Scheduler wiring:** module boots with the cron registered when enabled; `SCHEDULER_ENABLED=false` registers nothing; the job handler swallows a service throw (logs, does not propagate).
- **Gate:** mobile_purchase tsc 0 + full suite green; WIP-safety `git status`; no co-author.

## §5. Build order (for the plan)

1. **D2.1** — `@nestjs/schedule` dep + config keys (Zod) + `SchedulerModule` + `ExpirySweepJob` shell (enabled-flag + error-swallowing + logging), wired into `AppModule`; module/wiring tests.
2. **D2.2** — `SubscriptionExpirySweepService`: candidate query + per-row reducer application + batching + advisory-lock guard; Testcontainers spec (full §4 matrix).
3. **D2.3** — verify gate (tsc, sweep spec solo, full suite, WIP-safety, ledger).

## §6. Out of scope (explicit)

- Any second job (reconciliation, RC-mirror backfill, alert evaluation) — X2's future increments.
- Job-framework abstractions (queues, job tables, retries-with-backoff) — YAGNI for one cron.
- Reader predicate fixes (§3 follow-up), X1 deploy wiring, multi-process worker split, alerting/metrics export for the scheduler itself.

## §7. Reference — key existing symbols

- `Subscription` (`expiresAt`, `gracePeriodExpiresAt`, `status: SubscriptionStatus`, `lastEventAt`); `SubscriptionStatus` = `{ TRIAL, INTRO, ACTIVE, CANCELLED, GRACE_PERIOD, BILLING_RETRY, PAUSED, EXPIRED, REVOKED }` (`prisma/schema.prisma:63-73, 243-249`).
- Lifecycle: `subscription-lifecycle-reducer.ts` (`EXPIRED` case :204-208; ordering guard :75-77); persist seam `src/webhooks/shared/persist-lifecycle-event.ts` (`applySubscriptionLifecycle` :142-169; identity keys `[projectId, store, originalTransactionId|purchaseToken]`).
- Compute-on-read: `compute-customer-info.ts:68-70` (`isSubscriptionActive` checks `expiresAt` at read time).
- Stale readers (context, unchanged): `customers-query.service.ts:64-69`, `summary.service.ts:83-93` + `:164`.
- Config: `AppConfigModule` (Zod schema). Clock-injection precedent: `RefundService.refund(..., nowMs)`, metrics services.
