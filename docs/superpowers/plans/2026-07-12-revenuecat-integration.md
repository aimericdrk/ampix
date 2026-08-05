# RevenueCat Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect RevenueCat to MyAmpix — webhook ingestion, SDK identity link, subscription events in the user timeline, a Subscriptions page, and subscription filters across all analytics — strictly optional per project.

**Architecture:** New backend bounded context `backend/src/revenuecat/` (Prisma config/state/journal tables + journaled idempotent webhook + RC API v2 backfill). Webhooks become `$rc_*` ClickHouse events on the resolved distinct_id plus `$rc_*` profile properties via the existing `ProfileWriter`, so timeline/insights/cohorts work natively. One additive query-engine extension (`target: 'profile'` filters + `profile` cohort conditions) powers "filter everywhere". Dashboard gates every RC surface on a per-project `integrations.revenuecat` flag.

**Tech Stack:** NestJS + Prisma (Postgres) + ClickHouse + zod (backend), React 18 + TanStack Router/Query + MSW/Vitest (dashboard), Flutter (SDK).

**Spec:** `docs/superpowers/specs/2026-07-12-revenuecat-integration-design.md`

## Global Constraints

- **Optional:** a project with no `RevenueCatIntegration` row behaves byte-for-byte as today. Every RC surface (nav, chips, cards, KPIs) renders/executes only when the row/flag exists. Existing test suites stay green untouched.
- **No scheduler exists.** No cron. Backfill = fire-and-forget async from a request; reconciliation = on-demand endpoints only.
- **Journal-first webhook:** never lose an accepted payload; failures land in `RevenueCatWebhookEvent` with status `failed` for replay. Respond 200 fast.
- **RC API key is write-only** from the dashboard (masked after save: `…` + last 4). Never logged.
- ClickHouse params are ALWAYS bound `{name:Type}` — never interpolate caller input. Reserved `$rc_*` event names are module-local literals (codebase convention).
- Money is stored as integer cents (`Math.round(price * 100)`); RC webhook `price` is float USD.
- Subscription statuses: `trial | active | grace | paused | churned` (EXPIRATION → `churned`; no separate `expired`).
- Backend tests: `cd backend && npx jest <path>` (all: `npm test`). Dashboard: `cd dashboard && npx vitest run <path>`. SDK: `cd sdk/flutter_analytics && flutter test <path>`. Typecheck backend: `cd backend && npm run typecheck`.
- Commit after every task (conventional message, no co-author). The user pushes; never push.

---

# Phase 1 — Backend core

### Task 1: Prisma models + migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (append models; add 3 relation fields to `Project`)
- Create: `backend/prisma/migrations/<timestamp>_revenuecat_integration/` (generated)

**Interfaces:**
- Consumes: existing `Project` model (§`backend/prisma/schema.prisma:90-107`).
- Produces: Prisma client models `revenueCatIntegration`, `subscriptionState`, `revenueCatWebhookEvent` used by Tasks 4–8, 12.

- [ ] **Step 1: Append models to `backend/prisma/schema.prisma`**

Add to the `Project` model's relation list (after `projectMemberships`):

```prisma
  revenuecatIntegration RevenueCatIntegration?
  subscriptionStates    SubscriptionState[]
  revenuecatWebhookEvents RevenueCatWebhookEvent[]
```

Append at end of file:

```prisma
model RevenueCatIntegration {
  id             String    @id @default(uuid(7)) @db.Uuid
  projectId      String    @unique @map("project_id") @db.Uuid
  webhookSecret  String    @map("webhook_secret")
  apiKey         String?   @map("api_key")
  rcProjectId    String?   @map("rc_project_id")
  sandboxMode    Boolean   @default(false) @map("sandbox_mode")
  lastWebhookAt  DateTime? @map("last_webhook_at")
  backfillStatus String?   @map("backfill_status")
  connectedAt    DateTime  @default(now()) @map("connected_at")
  project        Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@map("revenuecat_integrations")
}

model SubscriptionState {
  id              String    @id @default(uuid(7)) @db.Uuid
  projectId       String    @map("project_id") @db.Uuid
  rcAppUserId     String    @map("rc_app_user_id")
  distinctId      String?   @map("distinct_id")
  status          String
  productId       String?   @map("product_id")
  store           String?
  periodType      String?   @map("period_type")
  priceCents      Int?      @map("price_cents")
  currency        String?
  mrrCents        Int       @default(0) @map("mrr_cents")
  totalSpentCents Int       @default(0) @map("total_spent_cents")
  firstPurchaseAt DateTime? @map("first_purchase_at")
  expiresAt       DateTime? @map("expires_at")
  cancelledAt     DateTime? @map("cancelled_at")
  lastEventAt     DateTime? @map("last_event_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  project         Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, rcAppUserId])
  @@index([projectId, status])
  @@index([projectId, distinctId])
  @@map("subscription_states")
}

model RevenueCatWebhookEvent {
  id          String    @id @default(uuid(7)) @db.Uuid
  projectId   String    @map("project_id") @db.Uuid
  rcEventId   String    @map("rc_event_id")
  eventType   String    @map("event_type")
  rcAppUserId String?   @map("rc_app_user_id")
  payload     Json
  status      String
  error       String?
  receivedAt  DateTime  @default(now()) @map("received_at")
  processedAt DateTime? @map("processed_at")
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, rcEventId])
  @@index([projectId, status])
  @@map("revenuecat_webhook_events")
}
```

`status` columns are strings validated in code (matches `SavedReport.kind` looseness elsewhere): journal `processed|failed|unlinked|skipped`; state `trial|active|grace|paused|churned`.

- [ ] **Step 2: Generate the migration (requires the dev Postgres from `infra/docker-compose.yml` running)**

Run: `cd backend && npx prisma migrate dev --name revenuecat_integration`
Expected: new dir `backend/prisma/migrations/<ts>_revenuecat_integration/migration.sql` creating the 3 tables; `Prisma Client` regenerated. If the stack is down: `bash scripts/dev.sh` first (or `docker compose -f infra/docker-compose.yml up -d postgres`).

- [ ] **Step 3: Verify typecheck + existing tests**

Run: `cd backend && npm run typecheck && npm test`
Expected: PASS (no behavior change — pure schema addition).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma
git commit -m "feat(backend): prisma models for revenuecat integration, subscription state, webhook journal"
```

---

### Task 2: RC webhook payload schema + pure event mapper

**Files:**
- Create: `backend/src/revenuecat/rc-webhook.schema.ts`
- Create: `backend/src/revenuecat/rc-event-mapper.ts`
- Test: `backend/src/revenuecat/rc-event-mapper.spec.ts`

**Interfaces:**
- Consumes: `EventRow`, `toChDateTime64` from `../clickhouse/clickhouse.service`; `ProfileOperation` from `@myampix/contracts` (`{ distinct_id, op, properties?, timestamp }`).
- Produces (used by Tasks 4, 8):
  - `rcWebhookBodySchema` / `RcWebhookEvent` (zod, `.passthrough()` — forward-compatible)
  - `rcEventName(type: string): string | null`
  - `toEventRow(projectId: string, distinctId: string, ev: RcWebhookEvent, nowMs: number): EventRow`
  - `deriveStatePatch(ev: RcWebhookEvent): StatePatch`
  - `computeMrrCents(priceCents: number, purchasedAtMs?: number, expirationAtMs?: number | null): number`
  - `profileOpsFor(distinctId: string, state: ProfileSnapshot, nowMs: number): ProfileOperation[]`

- [ ] **Step 1: Write the failing test `backend/src/revenuecat/rc-event-mapper.spec.ts`**

```ts
import {
  rcEventName,
  toEventRow,
  deriveStatePatch,
  computeMrrCents,
  profileOpsFor,
} from './rc-event-mapper';
import { rcWebhookBodySchema } from './rc-webhook.schema';

const BASE = {
  id: 'evt-uuid-1',
  type: 'INITIAL_PURCHASE',
  app_user_id: 'user-1',
  product_id: 'pro_monthly',
  period_type: 'NORMAL',
  purchased_at_ms: 1_750_000_000_000,
  expiration_at_ms: 1_752_592_000_000, // +30d
  event_timestamp_ms: 1_750_000_001_000,
  store: 'APP_STORE',
  environment: 'PRODUCTION',
  price: 9.99,
  currency: 'USD',
};

describe('rcWebhookBodySchema', () => {
  it('accepts a minimal payload and passes unknown keys through', () => {
    const parsed = rcWebhookBodySchema.parse({ api_version: '1.0', event: { ...BASE, future_field: 1 } });
    expect(parsed.event.id).toBe('evt-uuid-1');
  });
  it('rejects a payload without event.id', () => {
    expect(rcWebhookBodySchema.safeParse({ event: { type: 'RENEWAL', app_user_id: 'u', event_timestamp_ms: 1 } }).success).toBe(false);
  });
});

describe('rcEventName', () => {
  it.each([
    ['INITIAL_PURCHASE', '$rc_initial_purchase'],
    ['RENEWAL', '$rc_renewal'],
    ['CANCELLATION', '$rc_cancellation'],
    ['UNCANCELLATION', '$rc_uncancellation'],
    ['NON_RENEWING_PURCHASE', '$rc_non_renewing_purchase'],
    ['EXPIRATION', '$rc_expiration'],
    ['BILLING_ISSUE', '$rc_billing_issue'],
    ['PRODUCT_CHANGE', '$rc_product_change'],
    ['SUBSCRIPTION_PAUSED', '$rc_paused'],
    ['TRANSFER', '$rc_transfer'],
  ])('%s -> %s', (type, name) => expect(rcEventName(type)).toBe(name));
  it('returns null for TEST and unknown types', () => {
    expect(rcEventName('TEST')).toBeNull();
    expect(rcEventName('SOME_FUTURE_TYPE')).toBeNull();
  });
});

describe('toEventRow', () => {
  it('builds a complete EventRow with $rc_* properties', () => {
    const row = toEventRow('pid-1', 'distinct-1', BASE, 1_750_000_002_000);
    expect(row.project_id).toBe('pid-1');
    expect(row.event).toBe('$rc_initial_purchase');
    expect(row.distinct_id).toBe('distinct-1');
    expect(row.insert_id).toBe('evt-uuid-1');
    expect(row.anon_id).toBe('');
    expect(row.session_id).toBe('');
    expect(row.properties).toMatchObject({
      $rc_event_type: 'INITIAL_PURCHASE',
      $price: 9.99,
      $currency: 'USD',
      $product_id: 'pro_monthly',
      $rc_store: 'APP_STORE',
      $rc_period_type: 'NORMAL',
      $rc_environment: 'PRODUCTION',
    });
    expect(row.screen_width).toBe(0);
    expect(row.sdk_version).toBe('revenuecat-webhook');
  });
});

describe('deriveStatePatch', () => {
  it('INITIAL_PURCHASE NORMAL -> active with price/mrr/spend', () => {
    const p = deriveStatePatch(BASE);
    expect(p.status).toBe('active');
    expect(p.priceCents).toBe(999);
    expect(p.addSpendCents).toBe(999);
    expect(p.mrrCents).toBe(computeMrrCents(999, BASE.purchased_at_ms, BASE.expiration_at_ms));
    expect(p.firstPurchaseAt).toEqual(new Date(BASE.purchased_at_ms));
  });
  it('INITIAL_PURCHASE TRIAL -> trial with zero mrr', () => {
    const p = deriveStatePatch({ ...BASE, period_type: 'TRIAL', price: 0 });
    expect(p.status).toBe('trial');
    expect(p.mrrCents).toBe(0);
    expect(p.addSpendCents).toBe(0);
  });
  it('RENEWAL -> active; CANCELLATION sets cancelledAt only; UNCANCELLATION clears it', () => {
    expect(deriveStatePatch({ ...BASE, type: 'RENEWAL' }).status).toBe('active');
    const c = deriveStatePatch({ ...BASE, type: 'CANCELLATION', price: null });
    expect(c.status).toBeUndefined();
    expect(c.cancelledAt).toEqual(new Date(BASE.event_timestamp_ms));
    const u = deriveStatePatch({ ...BASE, type: 'UNCANCELLATION', price: null });
    expect(u.cancelledAt).toBeNull();
  });
  it('EXPIRATION -> churned with zero mrr; BILLING_ISSUE -> grace; SUBSCRIPTION_PAUSED -> paused', () => {
    const e = deriveStatePatch({ ...BASE, type: 'EXPIRATION', price: null });
    expect(e.status).toBe('churned');
    expect(e.mrrCents).toBe(0);
    expect(deriveStatePatch({ ...BASE, type: 'BILLING_ISSUE', price: null }).status).toBe('grace');
    expect(deriveStatePatch({ ...BASE, type: 'SUBSCRIPTION_PAUSED', price: null }).status).toBe('paused');
  });
  it('PRODUCT_CHANGE updates productId from new_product_id; TRANSFER is a no-op patch', () => {
    expect(deriveStatePatch({ ...BASE, type: 'PRODUCT_CHANGE', new_product_id: 'pro_yearly', price: null }).productId).toBe('pro_yearly');
    expect(deriveStatePatch({ ...BASE, type: 'TRANSFER', price: null })).toEqual({ addSpendCents: 0 });
  });
});

describe('computeMrrCents', () => {
  it('normalizes a 30-day cycle 1:1 and a yearly cycle /12', () => {
    const d = 86_400_000;
    expect(computeMrrCents(999, 0, 30 * d)).toBe(999);
    expect(computeMrrCents(9_999, 0, 365 * d)).toBe(Math.round((9_999 * 30) / 365));
  });
  it('falls back to the raw price when the cycle is unknown', () => {
    expect(computeMrrCents(999, undefined, undefined)).toBe(999);
  });
});

describe('profileOpsFor', () => {
  it('emits one set op with the $rc_* properties', () => {
    const ops = profileOpsFor('distinct-1', {
      status: 'active', productId: 'pro_monthly', store: 'APP_STORE', periodType: 'NORMAL',
      totalSpentCents: 999, firstPurchaseAt: new Date(1_750_000_000_000),
      expiresAt: new Date(1_752_592_000_000), cancelledAt: null,
    }, 1_750_000_002_000);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      distinct_id: 'distinct-1',
      op: 'set',
      timestamp: 1_750_000_002_000,
      properties: {
        $rc_status: 'active',
        $rc_product_id: 'pro_monthly',
        $rc_store: 'APP_STORE',
        $rc_period_type: 'NORMAL',
        $rc_total_spent: 9.99,
        $rc_first_purchase_at: new Date(1_750_000_000_000).toISOString(),
        $rc_expires_at: new Date(1_752_592_000_000).toISOString(),
        $rc_cancelled_at: null,
      },
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/revenuecat/rc-event-mapper.spec.ts`
Expected: FAIL — cannot find module `./rc-event-mapper`.

- [ ] **Step 3: Implement `rc-webhook.schema.ts` and `rc-event-mapper.ts`**

`backend/src/revenuecat/rc-webhook.schema.ts`:

```ts
import { z } from 'zod';

/**
 * RevenueCat webhook v1 payload (https://www.revenuecat.com/docs/integrations/webhooks).
 * Lenient by design: only the fields we act on are required; everything else passes
 * through so future RC fields never break ingestion (journal keeps the full payload).
 */
export const rcWebhookEventSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    app_user_id: z.string().min(1),
    original_app_user_id: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    product_id: z.string().nullish(),
    period_type: z.string().nullish(),
    purchased_at_ms: z.number().optional(),
    expiration_at_ms: z.number().nullish(),
    event_timestamp_ms: z.number(),
    store: z.string().nullish(),
    environment: z.string().nullish(),
    price: z.number().nullish(),
    currency: z.string().nullish(),
    transaction_id: z.string().nullish(),
    cancel_reason: z.string().nullish(),
    expiration_reason: z.string().nullish(),
    new_product_id: z.string().nullish(),
  })
  .passthrough();

export const rcWebhookBodySchema = z
  .object({ api_version: z.string().optional(), event: rcWebhookEventSchema })
  .passthrough();

export type RcWebhookEvent = z.infer<typeof rcWebhookEventSchema>;
```

`backend/src/revenuecat/rc-event-mapper.ts`:

```ts
import type { ProfileOperation } from '@myampix/contracts';
import { EventRow, toChDateTime64 } from '../clickhouse/clickhouse.service';
import type { RcWebhookEvent } from './rc-webhook.schema';

/** Reserved $rc_* names, module-local literals per codebase convention (see IN_APP_PURCHASE_EVENT). */
const RC_EVENT_NAMES: Record<string, string> = {
  INITIAL_PURCHASE: '$rc_initial_purchase',
  RENEWAL: '$rc_renewal',
  CANCELLATION: '$rc_cancellation',
  UNCANCELLATION: '$rc_uncancellation',
  NON_RENEWING_PURCHASE: '$rc_non_renewing_purchase',
  EXPIRATION: '$rc_expiration',
  BILLING_ISSUE: '$rc_billing_issue',
  PRODUCT_CHANGE: '$rc_product_change',
  SUBSCRIPTION_PAUSED: '$rc_paused',
  TRANSFER: '$rc_transfer',
};

export type RcSubscriptionStatus = 'trial' | 'active' | 'grace' | 'paused' | 'churned';

/** null → no analytics event is written (TEST + unknown/future types are journal-only). */
export function rcEventName(type: string): string | null {
  return Object.prototype.hasOwnProperty.call(RC_EVENT_NAMES, type) ? RC_EVENT_NAMES[type] : null;
}

const DAY_MS = 86_400_000;

/** Monthly-normalized recurring cents; cycle inferred from purchase→expiration span. */
export function computeMrrCents(
  priceCents: number,
  purchasedAtMs?: number,
  expirationAtMs?: number | null,
): number {
  if (purchasedAtMs === undefined || expirationAtMs === undefined || expirationAtMs === null) {
    return priceCents;
  }
  const cycleDays = Math.max(1, Math.round((expirationAtMs - purchasedAtMs) / DAY_MS));
  return Math.round((priceCents * 30) / cycleDays);
}

export function toEventRow(
  projectId: string,
  distinctId: string,
  ev: RcWebhookEvent,
  nowMs: number,
): EventRow {
  const name = rcEventName(ev.type);
  if (name === null) throw new Error(`no analytics event for RC type ${ev.type}`);
  const properties: Record<string, unknown> = {
    $rc_event_type: ev.type,
    $price: ev.price ?? 0,
    $currency: ev.currency ?? '',
    $product_id: ev.product_id ?? '',
    $rc_store: ev.store ?? '',
    $rc_period_type: ev.period_type ?? '',
    $rc_environment: ev.environment ?? '',
  };
  if (ev.cancel_reason) properties.$rc_cancel_reason = ev.cancel_reason;
  if (ev.expiration_reason) properties.$rc_expiration_reason = ev.expiration_reason;
  if (ev.new_product_id) properties.$rc_new_product_id = ev.new_product_id;
  return {
    project_id: projectId,
    insert_id: ev.id,
    event: name,
    distinct_id: distinctId,
    anon_id: '',
    session_id: '',
    timestamp: toChDateTime64(ev.event_timestamp_ms),
    server_timestamp: toChDateTime64(nowMs),
    properties,
    app_version: '',
    app_build: '',
    os: '',
    os_version: '',
    device_model: '',
    device_manufacturer: '',
    locale: '',
    timezone: '',
    screen_width: 0,
    screen_height: 0,
    network: '',
    sdk_version: 'revenuecat-webhook',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_content: '',
    utm_term: '',
    first_utm_source: '',
    first_utm_campaign: '',
    install_referrer: '',
  };
}

export interface StatePatch {
  status?: RcSubscriptionStatus;
  productId?: string;
  store?: string;
  periodType?: string;
  priceCents?: number;
  currency?: string;
  mrrCents?: number;
  expiresAt?: Date | null;
  cancelledAt?: Date | null;
  firstPurchaseAt?: Date;
  addSpendCents: number;
}

export function deriveStatePatch(ev: RcWebhookEvent): StatePatch {
  const priceCents = Math.round((ev.price ?? 0) * 100);
  const common = {
    productId: ev.product_id ?? undefined,
    store: ev.store ?? undefined,
    periodType: ev.period_type ?? undefined,
    currency: ev.currency ?? undefined,
    expiresAt: ev.expiration_at_ms != null ? new Date(ev.expiration_at_ms) : undefined,
  };
  switch (ev.type) {
    case 'INITIAL_PURCHASE': {
      const trial = ev.period_type === 'TRIAL';
      return {
        ...common,
        status: trial ? 'trial' : 'active',
        priceCents,
        mrrCents: trial ? 0 : computeMrrCents(priceCents, ev.purchased_at_ms, ev.expiration_at_ms),
        addSpendCents: priceCents,
        firstPurchaseAt: new Date(ev.purchased_at_ms ?? ev.event_timestamp_ms),
      };
    }
    case 'RENEWAL':
      return {
        ...common,
        status: 'active',
        priceCents,
        mrrCents: computeMrrCents(priceCents, ev.purchased_at_ms, ev.expiration_at_ms),
        addSpendCents: priceCents,
        cancelledAt: null,
      };
    case 'NON_RENEWING_PURCHASE':
      return { ...common, addSpendCents: priceCents };
    case 'CANCELLATION':
      return { ...common, cancelledAt: new Date(ev.event_timestamp_ms), addSpendCents: 0 };
    case 'UNCANCELLATION':
      return { ...common, cancelledAt: null, addSpendCents: 0 };
    case 'EXPIRATION':
      return { ...common, status: 'churned', mrrCents: 0, addSpendCents: 0 };
    case 'BILLING_ISSUE':
      return { ...common, status: 'grace', addSpendCents: 0 };
    case 'SUBSCRIPTION_PAUSED':
      return { ...common, status: 'paused', mrrCents: 0, addSpendCents: 0 };
    case 'PRODUCT_CHANGE':
      return { ...common, productId: ev.new_product_id ?? ev.product_id ?? undefined, addSpendCents: 0 };
    default:
      // TRANSFER + unknown: journal/event only, no state change.
      return { addSpendCents: 0 };
  }
}

export interface ProfileSnapshot {
  status: string;
  productId: string | null;
  store: string | null;
  periodType: string | null;
  totalSpentCents: number;
  firstPurchaseAt: Date | null;
  expiresAt: Date | null;
  cancelledAt: Date | null;
}

/** The $rc_* profile properties — the "filter everywhere" engine (spec §4.5). */
export function profileOpsFor(
  distinctId: string,
  state: ProfileSnapshot,
  nowMs: number,
): ProfileOperation[] {
  return [
    {
      distinct_id: distinctId,
      op: 'set',
      timestamp: nowMs,
      properties: {
        $rc_status: state.status,
        $rc_product_id: state.productId ?? '',
        $rc_store: state.store ?? '',
        $rc_period_type: state.periodType ?? '',
        $rc_total_spent: state.totalSpentCents / 100,
        $rc_first_purchase_at: state.firstPurchaseAt ? state.firstPurchaseAt.toISOString() : null,
        $rc_expires_at: state.expiresAt ? state.expiresAt.toISOString() : null,
        $rc_cancelled_at: state.cancelledAt ? state.cancelledAt.toISOString() : null,
      },
    },
  ];
}
```

Note: if `ProfileOperation.op` is a narrower zod enum, the literal `'set'` satisfies it. If `properties` rejects `null` values, replace `null` with `''` in `profileOpsFor` AND in the Step 1 assertions (check `packages/contracts/src/ingest.ts` `propertiesSchema` first — align the test with what the schema allows).

- [ ] **Step 4: Run the tests**

Run: `cd backend && npx jest src/revenuecat/rc-event-mapper.spec.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add backend/src/revenuecat
git commit -m "feat(backend): revenuecat webhook payload schema + pure event/state/profile mapper"
```

---

### Task 3: Identity resolution service

**Files:**
- Create: `backend/src/revenuecat/rc-identity.service.ts`
- Test: `backend/src/revenuecat/rc-identity.service.spec.ts`

**Interfaces:**
- Consumes: `ClickHouseService.query<T>(sql, params)`.
- Produces: `RcIdentityService.resolveDistinctId(projectId: string, appUserId: string): Promise<string | null>` (used by Tasks 4, 8). Resolution order per spec §4.4: explicit `$rc_link` > identity-mappings canonical > raw distinct_id presence > null.

- [ ] **Step 1: Write the failing test `backend/src/revenuecat/rc-identity.service.spec.ts`**

```ts
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { RcIdentityService } from './rc-identity.service';

function chMock(handler: (sql: string) => unknown[]) {
  return { query: jest.fn(async (sql: string) => handler(sql)) } as unknown as ClickHouseService;
}

describe('RcIdentityService.resolveDistinctId', () => {
  it('prefers the latest explicit $rc_link', async () => {
    const ch = chMock((sql) => (sql.includes("$rc_link") ? [{ distinct_id: 'linked-user' }] : []));
    const svc = new RcIdentityService(ch);
    await expect(svc.resolveDistinctId('pid', 'rc-app-user')).resolves.toBe('linked-user');
  });

  it('falls back to identity_mappings canonical id (convention: app_user_id was an anon id)', async () => {
    const ch = chMock((sql) => {
      if (sql.includes("$rc_link")) return [];
      if (sql.includes('identity_mappings')) return [{ canonical_id: 'canonical-user' }];
      return [];
    });
    const svc = new RcIdentityService(ch);
    await expect(svc.resolveDistinctId('pid', 'rc-app-user')).resolves.toBe('canonical-user');
  });

  it('falls back to the app_user_id itself when it exists as a distinct_id in events', async () => {
    const ch = chMock((sql) => {
      if (sql.includes("$rc_link") || sql.includes('identity_mappings')) return [];
      return [{ one: 1 }]; // presence probe
    });
    const svc = new RcIdentityService(ch);
    await expect(svc.resolveDistinctId('pid', 'known-distinct')).resolves.toBe('known-distinct');
  });

  it('returns null when nothing matches, and never resolves $RCAnonymousID via convention', async () => {
    const ch = chMock(() => []);
    const svc = new RcIdentityService(ch);
    await expect(svc.resolveDistinctId('pid', 'ghost')).resolves.toBeNull();
    const probing = chMock((sql) => (sql.includes("$rc_link") ? [] : [{ one: 1 }]));
    const svc2 = new RcIdentityService(probing);
    await expect(svc2.resolveDistinctId('pid', '$RCAnonymousID:abc')).resolves.toBeNull();
  });

  it('binds the app_user_id as a query param (never interpolates)', async () => {
    const ch = chMock(() => []);
    const svc = new RcIdentityService(ch);
    await svc.resolveDistinctId('pid', "evil'--");
    for (const call of (ch.query as jest.Mock).mock.calls) {
      expect(call[0]).not.toContain("evil'--");
      expect(call[1]).toMatchObject({ appUserId: "evil'--" });
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/revenuecat/rc-identity.service.spec.ts`
Expected: FAIL — cannot find module `./rc-identity.service`.

- [ ] **Step 3: Implement `backend/src/revenuecat/rc-identity.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service';

/**
 * Maps a RevenueCat app_user_id to a MyAmpix distinct_id (spec §4.4).
 * Order: explicit $rc_link event > identity_mappings canonical > raw distinct_id presence.
 * $RCAnonymousID:* ids only ever resolve via the explicit link.
 */
@Injectable()
export class RcIdentityService {
  constructor(private readonly clickhouse: ClickHouseService) {}

  async resolveDistinctId(projectId: string, appUserId: string): Promise<string | null> {
    const linked = await this.clickhouse.query<{ distinct_id: string }>(
      `SELECT distinct_id
       FROM events
       WHERE project_id = {projectId:UUID}
         AND event = '$rc_link'
         AND JSONExtractString(toJSONString(properties), '$rc_app_user_id') = {appUserId:String}
       ORDER BY timestamp DESC
       LIMIT 1`,
      { projectId, appUserId },
    );
    if (linked.length > 0) return linked[0].distinct_id;

    if (appUserId.startsWith('$RCAnonymousID:')) return null;

    const canonical = await this.clickhouse.query<{ canonical_id: string }>(
      `SELECT argMax(canonical_id, created_at) AS canonical_id
       FROM identity_mappings
       WHERE project_id = {projectId:UUID} AND anon_id = {appUserId:String}
       GROUP BY anon_id`,
      { projectId, appUserId },
    );
    if (canonical.length > 0 && canonical[0].canonical_id) return canonical[0].canonical_id;

    const present = await this.clickhouse.query<{ one: number }>(
      `SELECT 1 AS one
       FROM events
       WHERE project_id = {projectId:UUID} AND distinct_id = {appUserId:String}
       LIMIT 1`,
      { projectId, appUserId },
    );
    return present.length > 0 ? appUserId : null;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && npx jest src/revenuecat/rc-identity.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/revenuecat
git commit -m "feat(backend): revenuecat identity resolution (explicit link > convention > null)"
```

---

### Task 4: Webhook processor (journal → dedup → process → replay)

**Files:**
- Create: `backend/src/revenuecat/rc-webhook.processor.ts`
- Test: `backend/src/revenuecat/rc-webhook.processor.spec.ts`

**Interfaces:**
- Consumes: `rcWebhookBodySchema`, `rcEventName`, `toEventRow`, `deriveStatePatch`, `profileOpsFor` (Task 2); `RcIdentityService.resolveDistinctId` (Task 3); `ClickHouseService.insertEvents(rows)`; `ProfileWriter.apply(projectId, ops, nowMs)`; Prisma models (Task 1).
- Produces (used by Tasks 5, 7, 8):
  - `RcWebhookProcessor.process(integration: { id; projectId; sandboxMode }, body: unknown, nowMs?: number): Promise<void>` — throws `BadRequestException` only on unparseable payloads; all other failures are journaled.
  - `RcWebhookProcessor.replayUnlinked(projectId: string, rcAppUserId?: string, nowMs?: number): Promise<{ replayed: number; remaining: number }>`
  - `RcWebhookProcessor.applyEvent(...)` stays private; state upsert semantics: `totalSpentCents` increments, `firstPurchaseAt` set-once, patch fields overwrite when defined.

- [ ] **Step 1: Write the failing test `backend/src/revenuecat/rc-webhook.processor.spec.ts`**

```ts
import { BadRequestException } from '@nestjs/common';
import { RcWebhookProcessor } from './rc-webhook.processor';

const INTEGRATION = { id: 'int-1', projectId: 'pid-1', sandboxMode: false };
const NOW = 1_750_000_002_000;
const EVENT = {
  id: 'evt-1', type: 'INITIAL_PURCHASE', app_user_id: 'rc-user-1', product_id: 'pro_monthly',
  period_type: 'NORMAL', purchased_at_ms: 1_750_000_000_000, expiration_at_ms: 1_752_592_000_000,
  event_timestamp_ms: 1_750_000_001_000, store: 'APP_STORE', environment: 'PRODUCTION',
  price: 9.99, currency: 'USD',
};
const BODY = { api_version: '1.0', event: EVENT };

function buildMocks() {
  const journalRows: any[] = [];
  const stateRows = new Map<string, any>();
  const prisma = {
    revenueCatWebhookEvent: {
      create: jest.fn(async ({ data }: any) => {
        if (journalRows.some((r) => r.rcEventId === data.rcEventId)) {
          const err: any = new Error('unique'); err.code = 'P2002'; throw err;
        }
        const row = { id: `j-${journalRows.length}`, ...data }; journalRows.push(row); return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = journalRows.find((r) => r.id === where.id); Object.assign(row, data); return row;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        journalRows.filter((r) => r.status === 'unlinked' &&
          (where.rcAppUserId === undefined || r.rcAppUserId === where.rcAppUserId))),
    },
    subscriptionState: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = `${where.projectId_rcAppUserId.projectId}:${where.projectId_rcAppUserId.rcAppUserId}`;
        const existing = stateRows.get(key);
        const next = existing
          ? { ...existing, ...update, totalSpentCents: existing.totalSpentCents + (update.totalSpentCents?.increment ?? 0) }
          : { ...create };
        stateRows.set(key, next); return next;
      }),
    },
    revenueCatIntegration: { update: jest.fn(async () => ({})) },
  } as any;
  const clickhouse = { insertEvents: jest.fn(async () => undefined) } as any;
  const profileWriter = { apply: jest.fn(async () => undefined) } as any;
  const identity = { resolveDistinctId: jest.fn(async () => 'distinct-1') } as any;
  return { prisma, clickhouse, profileWriter, identity, journalRows, stateRows };
}

describe('RcWebhookProcessor.process', () => {
  it('journals, writes the CH event on the resolved id, upserts state, writes profile props, marks processed', async () => {
    const m = buildMocks();
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW);
    expect(m.journalRows[0].status).toBe('processed');
    expect(m.clickhouse.insertEvents).toHaveBeenCalledWith([
      expect.objectContaining({ event: '$rc_initial_purchase', distinct_id: 'distinct-1', insert_id: 'evt-1' }),
    ]);
    const state = m.stateRows.get('pid-1:rc-user-1');
    expect(state).toMatchObject({ status: 'active', distinctId: 'distinct-1' });
    expect(m.profileWriter.apply).toHaveBeenCalledWith('pid-1',
      [expect.objectContaining({ distinct_id: 'distinct-1', op: 'set' })], NOW);
    expect(m.prisma.revenueCatIntegration.update).toHaveBeenCalled();
  });

  it('is idempotent on the RC event id (duplicate → no second CH insert)', async () => {
    const m = buildMocks();
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW);
    await p.process(INTEGRATION, BODY, NOW);
    expect(m.clickhouse.insertEvents).toHaveBeenCalledTimes(1);
  });

  it('journals unresolvable identities as unlinked and skips CH/profile writes', async () => {
    const m = buildMocks();
    m.identity.resolveDistinctId.mockResolvedValue(null);
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW);
    expect(m.journalRows[0].status).toBe('unlinked');
    expect(m.clickhouse.insertEvents).not.toHaveBeenCalled();
    // state still tracked, without a distinct id:
    expect(m.stateRows.get('pid-1:rc-user-1')).toMatchObject({ distinctId: null, status: 'active' });
  });

  it('skips SANDBOX events when sandboxMode is off, processes them when on', async () => {
    const m = buildMocks();
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, { event: { ...EVENT, id: 'evt-sb', environment: 'SANDBOX' } }, NOW);
    expect(m.journalRows[0].status).toBe('skipped');
    await p.process({ ...INTEGRATION, sandboxMode: true },
      { event: { ...EVENT, id: 'evt-sb2', environment: 'SANDBOX' } }, NOW);
    expect(m.journalRows[1].status).toBe('processed');
  });

  it('journals TEST and unknown types as processed without a CH event', async () => {
    const m = buildMocks();
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, { event: { ...EVENT, id: 'evt-t', type: 'TEST' } }, NOW);
    await p.process(INTEGRATION, { event: { ...EVENT, id: 'evt-u', type: 'FUTURE_TYPE' } }, NOW);
    expect(m.journalRows.map((r) => r.status)).toEqual(['processed', 'processed']);
    expect(m.clickhouse.insertEvents).not.toHaveBeenCalled();
  });

  it('journals processing failures as failed with the error message', async () => {
    const m = buildMocks();
    m.clickhouse.insertEvents.mockRejectedValue(new Error('ch down'));
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW); // must NOT throw — RC gets its 200
    expect(m.journalRows[0]).toMatchObject({ status: 'failed', error: 'ch down' });
  });

  it('rejects an unparseable payload with 400', async () => {
    const m = buildMocks();
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await expect(p.process(INTEGRATION, { nope: true }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RcWebhookProcessor.replayUnlinked', () => {
  it('re-processes unlinked rows once the identity resolves', async () => {
    const m = buildMocks();
    m.identity.resolveDistinctId.mockResolvedValueOnce(null).mockResolvedValue('distinct-1');
    const p = new RcWebhookProcessor(m.prisma, m.clickhouse, m.profileWriter, m.identity);
    await p.process(INTEGRATION, BODY, NOW);
    expect(m.journalRows[0].status).toBe('unlinked');
    const result = await p.replayUnlinked('pid-1', 'rc-user-1', NOW);
    expect(result).toEqual({ replayed: 1, remaining: 0 });
    expect(m.journalRows[0].status).toBe('processed');
    expect(m.clickhouse.insertEvents).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/revenuecat/rc-webhook.processor.spec.ts`
Expected: FAIL — cannot find module `./rc-webhook.processor`.

- [ ] **Step 3: Implement `backend/src/revenuecat/rc-webhook.processor.ts`**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { ProfileWriter } from '../ingestion/profile-writer';
import { RcIdentityService } from './rc-identity.service';
import { rcWebhookBodySchema, RcWebhookEvent } from './rc-webhook.schema';
import { deriveStatePatch, profileOpsFor, rcEventName, toEventRow } from './rc-event-mapper';

export interface RcIntegrationRef {
  id: string;
  projectId: string;
  sandboxMode: boolean;
}

type JournalStatus = 'processed' | 'failed' | 'unlinked' | 'skipped';

/**
 * Journal-first webhook processing (spec §4.2): every accepted payload lands in
 * revenuecat_webhook_events before any side effect; failures never bubble to RC
 * (we own retries via replay), only unparseable bodies 400.
 */
@Injectable()
export class RcWebhookProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
    private readonly profileWriter: ProfileWriter,
    private readonly identity: RcIdentityService,
  ) {}

  async process(integration: RcIntegrationRef, body: unknown, nowMs = Date.now()): Promise<void> {
    const parsed = rcWebhookBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('unrecognized RevenueCat webhook payload');
    }
    const ev = parsed.data.event;

    let journal;
    try {
      journal = await this.prisma.revenueCatWebhookEvent.create({
        data: {
          projectId: integration.projectId,
          rcEventId: ev.id,
          eventType: ev.type,
          rcAppUserId: ev.app_user_id,
          payload: parsed.data as object,
          status: 'processed', // provisional; overwritten below
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return; // duplicate delivery — idempotent no-op
      throw err;
    }

    const { status, error } = await this.handle(integration, ev, nowMs);
    await this.prisma.revenueCatWebhookEvent.update({
      where: { id: journal.id },
      data: { status, error: error ?? null, processedAt: new Date(nowMs) },
    });
    await this.prisma.revenueCatIntegration.update({
      where: { id: integration.id },
      data: { lastWebhookAt: new Date(nowMs) },
    });

    if (status === 'processed') {
      // A successful resolution may unblock earlier webhook-before-link deliveries.
      await this.replayUnlinked(integration.projectId, ev.app_user_id, nowMs);
    }
  }

  async replayUnlinked(
    projectId: string,
    rcAppUserId?: string,
    nowMs = Date.now(),
  ): Promise<{ replayed: number; remaining: number }> {
    const rows = await this.prisma.revenueCatWebhookEvent.findMany({
      where: { projectId, status: 'unlinked', rcAppUserId },
      orderBy: { receivedAt: 'asc' },
      take: 200,
    });
    let replayed = 0;
    for (const row of rows) {
      const ev = (row.payload as { event: RcWebhookEvent }).event;
      const { status, error } = await this.handle(
        { id: '', projectId, sandboxMode: true },
        ev,
        nowMs,
      );
      if (status === 'processed') replayed += 1;
      await this.prisma.revenueCatWebhookEvent.update({
        where: { id: row.id },
        data: { status, error: error ?? null, processedAt: new Date(nowMs) },
      });
    }
    return { replayed, remaining: rows.length - replayed };
  }

  private async handle(
    integration: RcIntegrationRef,
    ev: RcWebhookEvent,
    nowMs: number,
  ): Promise<{ status: JournalStatus; error?: string }> {
    try {
      if (ev.environment === 'SANDBOX' && !integration.sandboxMode) {
        return { status: 'skipped' };
      }
      const eventName = rcEventName(ev.type);
      if (eventName === null) return { status: 'processed' }; // TEST / unknown: journal-only

      const distinctId = await this.identity.resolveDistinctId(integration.projectId, ev.app_user_id);
      const state = await this.upsertState(integration.projectId, ev, distinctId, nowMs);
      if (distinctId === null) return { status: 'unlinked' };

      await this.clickhouse.insertEvents([toEventRow(integration.projectId, distinctId, ev, nowMs)]);
      await this.profileWriter.apply(integration.projectId, profileOpsFor(distinctId, state, nowMs), nowMs);
      return { status: 'processed' };
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async upsertState(
    projectId: string,
    ev: RcWebhookEvent,
    distinctId: string | null,
    nowMs: number,
  ) {
    const patch = deriveStatePatch(ev);
    const { addSpendCents, firstPurchaseAt, ...fields } = patch;
    const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    return this.prisma.subscriptionState.upsert({
      where: { projectId_rcAppUserId: { projectId, rcAppUserId: ev.app_user_id } },
      create: {
        projectId,
        rcAppUserId: ev.app_user_id,
        distinctId,
        status: patch.status ?? 'active',
        productId: patch.productId ?? null,
        store: patch.store ?? null,
        periodType: patch.periodType ?? null,
        priceCents: patch.priceCents ?? null,
        currency: patch.currency ?? null,
        mrrCents: patch.mrrCents ?? 0,
        totalSpentCents: addSpendCents,
        firstPurchaseAt: firstPurchaseAt ?? null,
        expiresAt: patch.expiresAt ?? null,
        cancelledAt: patch.cancelledAt ?? null,
        lastEventAt: new Date(nowMs),
      },
      update: {
        ...defined,
        ...(distinctId !== null ? { distinctId } : {}),
        totalSpentCents: { increment: addSpendCents },
        ...(firstPurchaseAt ? {} : {}), // firstPurchaseAt is set-once: only on create
        lastEventAt: new Date(nowMs),
      },
    });
  }
}
```

Note for the executor: `upsertState` must return the row shaped like `ProfileSnapshot` (Task 2) — the mock in Step 1 returns the merged object, and the real Prisma upsert returns the row; both satisfy it. `replayUnlinked` passes `sandboxMode: true` so a journaled sandbox row replays if the operator enabled sandbox later; rows were only journaled `unlinked` when identity failed, so this cannot resurrect skipped rows (they carry status `skipped`, not `unlinked`).

- [ ] **Step 4: Run the tests**

Run: `cd backend && npx jest src/revenuecat/rc-webhook.processor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/revenuecat
git commit -m "feat(backend): journaled idempotent revenuecat webhook processor with unlinked replay"
```

---

### Task 5: Webhook guard + controller + module wiring

**Files:**
- Create: `backend/src/revenuecat/rc-webhook.guard.ts`
- Create: `backend/src/revenuecat/rc-webhook.controller.ts`
- Create: `backend/src/revenuecat/revenuecat.module.ts`
- Modify: `backend/src/app.module.ts` (add `RevenueCatModule` to imports)
- Test: `backend/src/revenuecat/rc-webhook.guard.spec.ts`, `backend/src/revenuecat/rc-webhook.controller.spec.ts`

**Interfaces:**
- Consumes: `RcWebhookProcessor.process` (Task 4); Prisma `revenueCatIntegration.findUnique`.
- Produces: `POST /webhooks/revenuecat/:projectId` (public route, header-secret auth, always 200 on accepted payloads). Guard attaches `req.rcIntegration: RcIntegrationRef`.

- [ ] **Step 1: Write the failing guard test `backend/src/revenuecat/rc-webhook.guard.spec.ts`**

```ts
import { ExecutionContext, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { RcWebhookGuard } from './rc-webhook.guard';

const PID = '0197f6a0-0000-7000-8000-0000000000aa';
const ROW = { id: 'int-1', projectId: PID, sandboxMode: false, webhookSecret: 'rcwh_secret_value_123456' };

function ctx(params: Record<string, string>, authorization?: string) {
  const req: any = { params, headers: authorization ? { authorization } : {} };
  return {
    req,
    context: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext,
  };
}

describe('RcWebhookGuard', () => {
  const prisma = { revenueCatIntegration: { findUnique: jest.fn() } } as any;
  const guard = new RcWebhookGuard(prisma);
  beforeEach(() => prisma.revenueCatIntegration.findUnique.mockReset());

  it('404s a non-uuid projectId without touching the db', async () => {
    const { context } = ctx({ projectId: 'nope' }, ROW.webhookSecret);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.revenueCatIntegration.findUnique).not.toHaveBeenCalled();
  });

  it('404s when the project has no integration', async () => {
    prisma.revenueCatIntegration.findUnique.mockResolvedValue(null);
    const { context } = ctx({ projectId: PID }, ROW.webhookSecret);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('401s a wrong or missing Authorization header', async () => {
    prisma.revenueCatIntegration.findUnique.mockResolvedValue(ROW);
    await expect(guard.canActivate(ctx({ projectId: PID }, 'wrong').context))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx({ projectId: PID }).context))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts the exact secret (with or without a Bearer prefix) and attaches rcIntegration', async () => {
    prisma.revenueCatIntegration.findUnique.mockResolvedValue(ROW);
    const a = ctx({ projectId: PID }, ROW.webhookSecret);
    await expect(guard.canActivate(a.context)).resolves.toBe(true);
    expect(a.req.rcIntegration).toMatchObject({ id: 'int-1', projectId: PID });
    const b = ctx({ projectId: PID }, `Bearer ${ROW.webhookSecret}`);
    await expect(guard.canActivate(b.context)).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing controller test `backend/src/revenuecat/rc-webhook.controller.spec.ts`**

```ts
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RcWebhookController } from './rc-webhook.controller';
import { RcWebhookGuard } from './rc-webhook.guard';

describe('RcWebhookController', () => {
  it('mounts RcWebhookGuard (and ONLY it — no JWT on the public webhook)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, RcWebhookController);
    expect(guards).toEqual([RcWebhookGuard]);
  });

  it('delegates to the processor with the guard-attached integration', async () => {
    const processor = { process: jest.fn(async () => undefined) } as any;
    const controller = new RcWebhookController(processor);
    const req: any = { rcIntegration: { id: 'int-1', projectId: 'pid', sandboxMode: false } };
    await controller.receive(req, { event: {} });
    expect(processor.process).toHaveBeenCalledWith(req.rcIntegration, { event: {} });
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd backend && npx jest src/revenuecat/rc-webhook.guard.spec.ts src/revenuecat/rc-webhook.controller.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement guard, controller, module; register in app.module**

`backend/src/revenuecat/rc-webhook.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { RcIntegrationRef } from './rc-webhook.processor';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RcWebhookRequest extends Request {
  rcIntegration?: RcIntegrationRef;
}

/**
 * Authenticates RevenueCat's webhook calls: the Authorization header the user pasted
 * into the RC dashboard must equal the project's generated webhookSecret (spec §4.2).
 * Constant-time compare; RC may or may not send a "Bearer " prefix — accept both.
 */
@Injectable()
export class RcWebhookGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RcWebhookRequest>();
    const projectId = req.params.projectId;
    if (!UUID_RE.test(projectId)) throw new NotFoundException();

    const integration = await this.prisma.revenueCatIntegration.findUnique({ where: { projectId } });
    if (integration === null) throw new NotFoundException();

    const raw = req.headers.authorization ?? '';
    const provided = raw.startsWith('Bearer ') ? raw.slice('Bearer '.length) : raw;
    const a = Buffer.from(provided);
    const b = Buffer.from(integration.webhookSecret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();

    req.rcIntegration = {
      id: integration.id,
      projectId: integration.projectId,
      sandboxMode: integration.sandboxMode,
    };
    return true;
  }
}
```

`backend/src/revenuecat/rc-webhook.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { RcWebhookGuard, RcWebhookRequest } from './rc-webhook.guard';
import { RcWebhookProcessor } from './rc-webhook.processor';

/** Public endpoint RevenueCat calls; auth = RcWebhookGuard, never JWT (spec §4.2). */
@Controller('webhooks/revenuecat')
@UseGuards(RcWebhookGuard)
export class RcWebhookController {
  constructor(private readonly processor: RcWebhookProcessor) {}

  @Post(':projectId')
  @HttpCode(200)
  async receive(@Req() req: RcWebhookRequest, @Body() body: unknown): Promise<void> {
    await this.processor.process(req.rcIntegration!, body);
  }
}
```

`backend/src/revenuecat/revenuecat.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ProfileWriter } from '../ingestion/profile-writer';
import { RcIdentityService } from './rc-identity.service';
import { RcWebhookController } from './rc-webhook.controller';
import { RcWebhookGuard } from './rc-webhook.guard';
import { RcWebhookProcessor } from './rc-webhook.processor';

@Module({
  controllers: [RcWebhookController],
  providers: [RcWebhookGuard, RcWebhookProcessor, RcIdentityService, ProfileWriter],
  exports: [RcWebhookProcessor, RcIdentityService],
})
export class RevenueCatModule {}
```

(If `ProfileWriter` is already provided/exported by `IngestModule`, import that module instead of re-providing — check `backend/src/ingestion/ingest.module.ts` exports and prefer `imports: [IngestModule]`.)

`backend/src/app.module.ts`: add `RevenueCatModule` to the `imports` array (alongside the other feature modules) with its import statement.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd backend && npx jest src/revenuecat && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/revenuecat backend/src/app.module.ts
git commit -m "feat(backend): public revenuecat webhook endpoint with per-project secret auth"
```

---

### Task 6: `integrations.revenuecat` flag on GET /projects

**Files:**
- Modify: `backend/src/projects/projects.service.ts` (`listForUser`, ~line 31, + `ProjectListItem` type)
- Test: extend the existing `backend/src/projects/projects.service.spec.ts` (or controller spec where `listForUser` is covered)

**Interfaces:**
- Produces: every item of `GET /api/v1/projects` gains `integrations: { revenuecat: boolean }`. This is THE gating fact for the whole dashboard (spec §6.1).

- [ ] **Step 1: Write the failing test (add to the existing projects service spec)**

Locate the existing `listForUser` test and its prisma mock; extend the mocked `projectMembership.findMany` include-result with `revenuecatIntegration` and add:

```ts
it('exposes integrations.revenuecat from the integration row presence', async () => {
  prisma.projectMembership.findMany.mockResolvedValue([
    membershipFixture({ revenuecatIntegration: { id: 'int-1' } }),
    membershipFixture({ revenuecatIntegration: null }),
  ]);
  const items = await service.listForUser('user-1');
  expect(items[0].integrations).toEqual({ revenuecat: true });
  expect(items[1].integrations).toEqual({ revenuecat: false });
});
```

(`membershipFixture` = whatever shape the existing tests already build for `m.project` — reuse it, adding the `revenuecatIntegration` key to `project`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/projects`
Expected: FAIL — `integrations` undefined.

- [ ] **Step 3: Implement**

In `listForUser`'s prisma query, add to `include.project.include`:

```ts
revenuecatIntegration: { select: { id: true } },
```

In the mapped return object add:

```ts
integrations: { revenuecat: m.project.revenuecatIntegration !== null },
```

And extend the `ProjectListItem` type (wherever it's declared — same file or contracts) with `integrations: { revenuecat: boolean }`.

- [ ] **Step 4: Run the full projects suite**

Run: `cd backend && npx jest src/projects && npm run typecheck`
Expected: PASS (existing assertions unaffected — additive field).

- [ ] **Step 5: Commit**

```bash
git add backend/src/projects packages/contracts 2>/dev/null || git add backend/src/projects
git commit -m "feat(backend): expose integrations.revenuecat flag on project list"
```

---

### Task 7: Management API (status / connect / disconnect / journal / replay / per-user state)

**Files:**
- Create: `backend/src/revenuecat/rc-admin.controller.ts`
- Create: `backend/src/revenuecat/rc-admin.service.ts`
- Create: `backend/src/revenuecat/rc-admin.schema.ts`
- Modify: `backend/src/revenuecat/revenuecat.module.ts` (register controller+service; `imports: [AuthModule, AuthzModule]`)
- Test: `backend/src/revenuecat/rc-admin.controller.spec.ts`, `backend/src/revenuecat/rc-admin.service.spec.ts`

**Interfaces:**
- Consumes: `ProjectsService.assertMembership(userId, projectId)`; `@ProjectRoles`/`ProjectRolesGuard` + `PROJECT_ROLES_KEY` from `backend/src/authz/`; `RcWebhookProcessor.replayUnlinked`; Prisma models.
- Produces (dashboard consumes in Tasks 16–17, 20):
  - `GET  /api/v1/projects/:projectId/integrations/revenuecat` → `RcIntegrationStatus` (admin)
  - `PUT  /api/v1/projects/:projectId/integrations/revenuecat` body `{ api_key?, rc_project_id?, sandbox_mode? }` → `RcIntegrationStatus` (admin; creates on first call, generating `webhookSecret = 'rcwh_' + 48 hex chars`)
  - `DELETE …/revenuecat` → 204 (admin; deletes ONLY the integration row — state + journal + CH events retained per spec)
  - `GET  …/revenuecat/events?status=failed|unlinked|skipped|processed` → `{ events: RcJournalEntry[] }` (admin, latest 50)
  - `POST …/revenuecat/replay` → `{ replayed, remaining }` (admin)
  - `GET  …/revenuecat/users/:distinctId` → `{ subscription: UserSubscription | null }` (any member — powers the profile card)

```ts
// rc-admin.service.ts response shapes (mirror in dashboard/src/lib/api/types.ts in Task 16)
export interface RcIntegrationStatus {
  connected: boolean;
  webhook_path: string;              // `/webhooks/revenuecat/${projectId}` — UI prefixes apiBaseUrl
  webhook_secret: string;            // full value: the admin must paste it into RC
  api_key_masked: string | null;     // '…' + last 4, or null
  rc_project_id: string | null;
  sandbox_mode: boolean;
  last_webhook_at: string | null;    // ISO
  backfill_status: string | null;
  counts: { processed: number; failed: number; unlinked: number; skipped: number };
}
export interface RcJournalEntry {
  id: string; rc_event_id: string; event_type: string; rc_app_user_id: string | null;
  status: string; error: string | null; received_at: string;
}
export interface UserSubscription {
  status: string; product_id: string | null; store: string | null; period_type: string | null;
  total_spent_cents: number; mrr_cents: number; currency: string | null;
  first_purchase_at: string | null; expires_at: string | null; cancelled_at: string | null;
  rc_app_user_id: string; rc_customer_url: string | null; // https://app.revenuecat.com/customers/{rc_project_id}/{urlencoded app_user_id} when rc_project_id set
}
```

- [ ] **Step 1: Write the failing controller metadata spec `rc-admin.controller.spec.ts`**

```ts
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectRolesGuard } from '../authz/project-roles.guard';
import { PROJECT_ROLES_KEY } from '../authz/project-roles.decorator';
import { RcAdminController } from './rc-admin.controller';

describe('RcAdminController authz metadata', () => {
  it('is JWT-guarded at class level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RcAdminController)).toEqual([JwtAuthGuard]);
  });

  it.each(['getStatus', 'upsert', 'disconnect', 'listJournal', 'replay'] as const)(
    '%s requires project admin via ProjectRolesGuard',
    (method) => {
      const handler = RcAdminController.prototype[method];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([ProjectRolesGuard]);
      expect(Reflect.getMetadata(PROJECT_ROLES_KEY, handler)).toBe('admin');
    },
  );

  it('getUserSubscription has no role gate (assertMembership in service)', () => {
    const handler = RcAdminController.prototype.getUserSubscription;
    expect(Reflect.getMetadata(PROJECT_ROLES_KEY, handler)).toBeUndefined();
  });
});
```

(Adjust the `JwtAuthGuard` import path to the real one — find it with `grep -rn "class JwtAuthGuard" backend/src/auth/`.)

- [ ] **Step 2: Write the failing service spec `rc-admin.service.spec.ts`**

```ts
import { RcAdminService } from './rc-admin.service';

const PID = '0197f6a0-0000-7000-8000-0000000000aa';
const ROW = {
  id: 'int-1', projectId: PID, webhookSecret: 'rcwh_abc', apiKey: 'sk_live_secret1234',
  rcProjectId: 'proj123', sandboxMode: false, lastWebhookAt: null, backfillStatus: null,
  connectedAt: new Date(0),
};

function build(overrides: { integration?: unknown } = {}) {
  const prisma = {
    revenueCatIntegration: {
      findUnique: jest.fn(async () => overrides.integration ?? null),
      upsert: jest.fn(async ({ create, update }: any) => ({ ...ROW, ...create, ...update })),
      delete: jest.fn(async () => ROW),
    },
    revenueCatWebhookEvent: {
      groupBy: jest.fn(async () => [{ status: 'processed', _count: { _all: 3 } }]),
      findMany: jest.fn(async () => []),
    },
    subscriptionState: { findFirst: jest.fn(async () => null) },
  } as any;
  const projects = { assertMembership: jest.fn(async () => undefined) } as any;
  const processor = { replayUnlinked: jest.fn(async () => ({ replayed: 1, remaining: 0 })) } as any;
  return { prisma, projects, processor, svc: new RcAdminService(prisma, projects, processor) };
}

describe('RcAdminService', () => {
  it('getStatus returns connected=false shell when no row exists', async () => {
    const { svc } = build();
    const s = await svc.getStatus(PID);
    expect(s).toMatchObject({ connected: false, webhook_path: `/webhooks/revenuecat/${PID}` });
  });

  it('getStatus masks the api key to its last 4 chars and returns counts', async () => {
    const { svc } = build({ integration: ROW });
    const s = await svc.getStatus(PID);
    expect(s.api_key_masked).toBe('…1234');
    expect(s.webhook_secret).toBe('rcwh_abc');
    expect(s.counts).toEqual({ processed: 3, failed: 0, unlinked: 0, skipped: 0 });
  });

  it('upsert generates a rcwh_ webhook secret on create and never regenerates it on update', async () => {
    const { svc, prisma } = build();
    await svc.upsert(PID, { api_key: 'k', rc_project_id: 'p', sandbox_mode: true });
    const args = prisma.revenueCatIntegration.upsert.mock.calls[0][0];
    expect(args.create.webhookSecret).toMatch(/^rcwh_[0-9a-f]{48}$/);
    expect(args.update.webhookSecret).toBeUndefined();
  });

  it('getUserSubscription asserts membership and returns null when unknown', async () => {
    const { svc, projects } = build();
    await expect(svc.getUserSubscription('u1', PID, 'ghost')).resolves.toEqual({ subscription: null });
    expect(projects.assertMembership).toHaveBeenCalledWith('u1', PID);
  });

  it('getUserSubscription builds rc_customer_url when rc_project_id is set', async () => {
    const { svc, prisma } = build({ integration: ROW });
    prisma.subscriptionState.findFirst.mockResolvedValue({
      status: 'active', productId: 'pro', store: 'APP_STORE', periodType: 'NORMAL',
      totalSpentCents: 999, mrrCents: 999, currency: 'USD', firstPurchaseAt: new Date(0),
      expiresAt: null, cancelledAt: null, rcAppUserId: 'rc user/1',
    });
    const r = await svc.getUserSubscription('u1', PID, 'distinct-1');
    expect(r.subscription!.rc_customer_url).toBe(
      'https://app.revenuecat.com/customers/proj123/rc%20user%2F1',
    );
  });
});
```

- [ ] **Step 3: Run to verify failures**

Run: `cd backend && npx jest src/revenuecat/rc-admin`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement schema, service, controller**

`backend/src/revenuecat/rc-admin.schema.ts`:

```ts
import { z } from 'zod';

export const rcUpsertSchema = z
  .object({
    api_key: z.string().trim().min(1).max(200).optional(),
    rc_project_id: z.string().trim().min(1).max(100).optional(),
    sandbox_mode: z.boolean().optional(),
  })
  .strict();

export type RcUpsertInput = z.infer<typeof rcUpsertSchema>;
```

`backend/src/revenuecat/rc-admin.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { RcWebhookProcessor } from './rc-webhook.processor';
import type { RcUpsertInput } from './rc-admin.schema';

export interface RcIntegrationStatus { /* exact shape from the Interfaces block above */ }
export interface RcJournalEntry { /* exact shape from the Interfaces block above */ }
export interface UserSubscription { /* exact shape from the Interfaces block above */ }

const JOURNAL_STATUSES = ['processed', 'failed', 'unlinked', 'skipped'] as const;

@Injectable()
export class RcAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly processor: RcWebhookProcessor,
  ) {}

  async getStatus(projectId: string): Promise<RcIntegrationStatus> {
    const row = await this.prisma.revenueCatIntegration.findUnique({ where: { projectId } });
    const webhook_path = `/webhooks/revenuecat/${projectId}`;
    if (row === null) {
      return {
        connected: false, webhook_path, webhook_secret: '', api_key_masked: null,
        rc_project_id: null, sandbox_mode: false, last_webhook_at: null, backfill_status: null,
        counts: { processed: 0, failed: 0, unlinked: 0, skipped: 0 },
      };
    }
    const grouped = await this.prisma.revenueCatWebhookEvent.groupBy({
      by: ['status'], where: { projectId }, _count: { _all: true },
    });
    const counts = { processed: 0, failed: 0, unlinked: 0, skipped: 0 };
    for (const g of grouped) {
      if ((JOURNAL_STATUSES as readonly string[]).includes(g.status)) {
        counts[g.status as (typeof JOURNAL_STATUSES)[number]] = g._count._all;
      }
    }
    return {
      connected: true,
      webhook_path,
      webhook_secret: row.webhookSecret,
      api_key_masked: row.apiKey ? `…${row.apiKey.slice(-4)}` : null,
      rc_project_id: row.rcProjectId,
      sandbox_mode: row.sandboxMode,
      last_webhook_at: row.lastWebhookAt?.toISOString() ?? null,
      backfill_status: row.backfillStatus,
      counts,
    };
  }

  async upsert(projectId: string, input: RcUpsertInput): Promise<RcIntegrationStatus> {
    const update: Record<string, unknown> = {};
    if (input.api_key !== undefined) update.apiKey = input.api_key;
    if (input.rc_project_id !== undefined) update.rcProjectId = input.rc_project_id;
    if (input.sandbox_mode !== undefined) update.sandboxMode = input.sandbox_mode;
    await this.prisma.revenueCatIntegration.upsert({
      where: { projectId },
      create: {
        projectId,
        webhookSecret: `rcwh_${randomBytes(24).toString('hex')}`,
        apiKey: input.api_key ?? null,
        rcProjectId: input.rc_project_id ?? null,
        sandboxMode: input.sandbox_mode ?? false,
      },
      update,
    });
    return this.getStatus(projectId);
  }

  async disconnect(projectId: string): Promise<void> {
    // Config only — SubscriptionState, journal, and CH events are kept (spec §4.7).
    await this.prisma.revenueCatIntegration.delete({ where: { projectId } });
  }

  async listJournal(projectId: string, status?: string): Promise<{ events: RcJournalEntry[] }> {
    const rows = await this.prisma.revenueCatWebhookEvent.findMany({
      where: { projectId, ...(status ? { status } : {}) },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
    return {
      events: rows.map((r) => ({
        id: r.id, rc_event_id: r.rcEventId, event_type: r.eventType,
        rc_app_user_id: r.rcAppUserId, status: r.status, error: r.error,
        received_at: r.receivedAt.toISOString(),
      })),
    };
  }

  async replay(projectId: string): Promise<{ replayed: number; remaining: number }> {
    return this.processor.replayUnlinked(projectId);
  }

  async getUserSubscription(
    userId: string,
    projectId: string,
    distinctId: string,
  ): Promise<{ subscription: UserSubscription | null }> {
    await this.projects.assertMembership(userId, projectId);
    const state = await this.prisma.subscriptionState.findFirst({
      where: { projectId, distinctId },
      orderBy: { updatedAt: 'desc' },
    });
    if (state === null) return { subscription: null };
    const integration = await this.prisma.revenueCatIntegration.findUnique({ where: { projectId } });
    const rcProjectId = integration?.rcProjectId ?? null;
    return {
      subscription: {
        status: state.status,
        product_id: state.productId,
        store: state.store,
        period_type: state.periodType,
        total_spent_cents: state.totalSpentCents,
        mrr_cents: state.mrrCents,
        currency: state.currency,
        first_purchase_at: state.firstPurchaseAt?.toISOString() ?? null,
        expires_at: state.expiresAt?.toISOString() ?? null,
        cancelled_at: state.cancelledAt?.toISOString() ?? null,
        rc_app_user_id: state.rcAppUserId,
        rc_customer_url: rcProjectId
          ? `https://app.revenuecat.com/customers/${rcProjectId}/${encodeURIComponent(state.rcAppUserId)}`
          : null,
      },
    };
  }
}
```

(Fill the three `interface` bodies with the exact shapes from this task's Interfaces block.)

`backend/src/revenuecat/rc-admin.controller.ts`:

```ts
import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthRequest } from '../auth/jwt-auth.guard';
import { ProjectRoles } from '../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../authz/project-roles.guard';
import { parseOrThrow } from '../common/parse-or-throw';
import { rcUpsertSchema } from './rc-admin.schema';
import { RcAdminService } from './rc-admin.service';

@Controller('api/v1/projects/:projectId/integrations/revenuecat')
@UseGuards(JwtAuthGuard)
export class RcAdminController {
  constructor(private readonly service: RcAdminService) {}

  @Get()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async getStatus(@Param('projectId') projectId: string) {
    return this.service.getStatus(projectId);
  }

  @Put()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async upsert(@Param('projectId') projectId: string, @Body() body: unknown) {
    return this.service.upsert(projectId, parseOrThrow(rcUpsertSchema, body));
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async disconnect(@Param('projectId') projectId: string) {
    await this.service.disconnect(projectId);
  }

  @Get('events')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async listJournal(@Param('projectId') projectId: string, @Query('status') status?: string) {
    return this.service.listJournal(projectId, status);
  }

  @Post('replay')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async replay(@Param('projectId') projectId: string) {
    return this.service.replay(projectId);
  }

  @Get('users/:distinctId')
  async getUserSubscription(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('distinctId') distinctId: string,
  ) {
    return this.service.getUserSubscription(req.user!.id, projectId, distinctId);
  }
}
```

(Adjust `JwtAuthGuard`/`AuthRequest`/`parseOrThrow` import paths to the real locations — grep for how `analytics.controller.ts` imports them and copy exactly. If there's no shared `parseOrThrow`, inline `rcUpsertSchema.parse` in a try/catch mapping ZodError → BadRequest the way other controllers do.)

Update `revenuecat.module.ts`: `imports: [AuthModule, AuthzModule]` (+ whatever module exports `ProjectsService` — check how other modules import it, likely `ProjectsModule`), add `RcAdminController` to `controllers`, `RcAdminService` to `providers`.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd backend && npx jest src/revenuecat && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/revenuecat
git commit -m "feat(backend): revenuecat management api (status, connect, journal, replay, per-user state)"
```

---

### Task 8: RC REST API client + backfill + resync/refresh endpoints

**Files:**
- Create: `backend/src/revenuecat/rc-api.client.ts`
- Create: `backend/src/revenuecat/rc-backfill.service.ts`
- Modify: `backend/src/revenuecat/rc-admin.controller.ts` (add `POST resync`, `POST users/:distinctId/refresh`)
- Modify: `backend/src/revenuecat/revenuecat.module.ts` (providers)
- Test: `backend/src/revenuecat/rc-api.client.spec.ts`, `backend/src/revenuecat/rc-backfill.service.spec.ts`

**Interfaces:**
- Consumes: native `fetch` (pattern: `backend/src/analytics/ai/mistral.service.ts` — AbortController + 15s timeout); `RcIdentityService`; `ProfileWriter`; Prisma.
- Produces:
  - `RcApiClient.listCustomers(apiKey, rcProjectId): AsyncGenerator<RcCustomer[]>` — pages `GET https://api.revenuecat.com/v2/projects/{id}/customers?limit=100[&starting_after=…]`, follows `next_page`.
  - `RcApiClient.getSubscriptions(apiKey, rcProjectId, customerId): Promise<RcApiSubscription[]>` — `GET …/customers/{id}/subscriptions`.
  - `RcBackfillService.run(projectId): Promise<void>` — sets `backfillStatus` `'running'` → `'done'`/`'failed: <msg>'`; **state + profile props only, NO ClickHouse events** (spec §4.6).
  - Controller: `POST …/revenuecat/resync` → 202 `{ status: 'started' }` (admin; fire-and-forget `void service.run(...)`); `POST …/revenuecat/users/:distinctId/refresh` → refreshed `{ subscription }` (analyst).
  - `RcCustomer = { id: string }`; `RcApiSubscription = { product_id: string; store: string; status: string; current_period_ends_at: number | null; gives_access: boolean; total_revenue_in_usd?: { gross: number } }` (lenient-parse: unknown fields ignored).

- [ ] **Step 1: Write the failing client test `rc-api.client.spec.ts`**

```ts
import { RcApiClient } from './rc-api.client';

function fetchMock(pages: Array<{ items: unknown[]; next_page?: string | null }>) {
  let call = 0;
  return jest.fn(async (url: string, init: any) => {
    expect(init.headers.Authorization).toBe('Bearer sk_test');
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return { ok: true, status: 200, json: async () => page } as Response;
  }) as unknown as typeof fetch;
}

describe('RcApiClient', () => {
  it('pages customers via next_page until exhausted', async () => {
    const f = fetchMock([
      { items: [{ id: 'c1' }, { id: 'c2' }], next_page: '/v2/projects/p1/customers?starting_after=c2' },
      { items: [{ id: 'c3' }], next_page: null },
    ]);
    const client = new RcApiClient(f);
    const batches: unknown[][] = [];
    for await (const batch of client.listCustomers('sk_test', 'p1')) batches.push(batch);
    expect(batches).toEqual([[{ id: 'c1' }, { id: 'c2' }], [{ id: 'c3' }]]);
    expect((f as unknown as jest.Mock).mock.calls[0][0]).toBe(
      'https://api.revenuecat.com/v2/projects/p1/customers?limit=100',
    );
    expect((f as unknown as jest.Mock).mock.calls[1][0]).toBe(
      'https://api.revenuecat.com/v2/projects/p1/customers?starting_after=c2',
    );
  });

  it('throws a descriptive error on non-2xx', async () => {
    const f = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    const client = new RcApiClient(f);
    await expect(client.getSubscriptions('bad', 'p1', 'c1')).rejects.toThrow(/revenuecat api 401/i);
  });
});
```

- [ ] **Step 2: Write the failing backfill test `rc-backfill.service.spec.ts`**

```ts
import { RcBackfillService } from './rc-backfill.service';

const PID = 'pid-1';
const ROW = { id: 'int-1', projectId: PID, apiKey: 'sk_test', rcProjectId: 'p1', sandboxMode: false };

function build() {
  const prisma = {
    revenueCatIntegration: {
      findUnique: jest.fn(async () => ROW),
      update: jest.fn(async () => ({})),
    },
    subscriptionState: { upsert: jest.fn(async ({ create }: any) => create) },
  } as any;
  const client = {
    listCustomers: jest.fn(async function* () { yield [{ id: 'rc-user-1' }]; }),
    getSubscriptions: jest.fn(async () => [
      { product_id: 'pro_monthly', store: 'app_store', status: 'active',
        current_period_ends_at: 1_752_592_000_000, gives_access: true },
    ]),
  } as any;
  const identity = { resolveDistinctId: jest.fn(async () => 'distinct-1') } as any;
  const profileWriter = { apply: jest.fn(async () => undefined) } as any;
  const clickhouse = { insertEvents: jest.fn() } as any;
  return { prisma, client, identity, profileWriter, clickhouse,
    svc: new RcBackfillService(prisma, client, identity, profileWriter) };
}

describe('RcBackfillService.run', () => {
  it('seeds SubscriptionState + profile props from the RC API without writing CH events', async () => {
    const m = build();
    await m.svc.run(PID);
    expect(m.prisma.subscriptionState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_rcAppUserId: { projectId: PID, rcAppUserId: 'rc-user-1' } },
      }),
    );
    expect(m.profileWriter.apply).toHaveBeenCalled();
    // status transitions running -> done
    const statuses = m.prisma.revenueCatIntegration.update.mock.calls.map(
      (c: any) => c[0].data.backfillStatus,
    );
    expect(statuses[0]).toBe('running');
    expect(statuses[statuses.length - 1]).toBe('done');
  });

  it('records failures on backfillStatus instead of throwing', async () => {
    const m = build();
    m.client.getSubscriptions.mockRejectedValue(new Error('boom'));
    await m.svc.run(PID);
    const last = m.prisma.revenueCatIntegration.update.mock.calls.at(-1)[0].data.backfillStatus;
    expect(last).toMatch(/^failed: boom/);
  });

  it('no-ops (status failed: missing credentials) when api key or rc project id is absent', async () => {
    const m = build();
    m.prisma.revenueCatIntegration.findUnique.mockResolvedValue({ ...ROW, apiKey: null });
    await m.svc.run(PID);
    expect(m.client.listCustomers).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failures**

Run: `cd backend && npx jest src/revenuecat/rc-api src/revenuecat/rc-backfill`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement client + backfill; wire endpoints**

`backend/src/revenuecat/rc-api.client.ts`:

```ts
import { Injectable } from '@nestjs/common';

const RC_API_BASE = 'https://api.revenuecat.com';
const TIMEOUT_MS = 15_000;

export interface RcCustomer { id: string }
export interface RcApiSubscription {
  product_id: string;
  store: string;
  status: string;
  current_period_ends_at: number | null;
  gives_access: boolean;
  total_revenue_in_usd?: { gross: number };
}

/** Thin RevenueCat REST API v2 wrapper; fetch injected for tests (Mistral pattern). */
@Injectable()
export class RcApiClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async get<T>(apiKey: string, path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${RC_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`revenuecat api ${res.status} for ${path}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async *listCustomers(apiKey: string, rcProjectId: string): AsyncGenerator<RcCustomer[]> {
    let path: string | null = `/v2/projects/${encodeURIComponent(rcProjectId)}/customers?limit=100`;
    while (path !== null) {
      const page = await this.get<{ items: RcCustomer[]; next_page?: string | null }>(apiKey, path);
      yield page.items ?? [];
      path = page.next_page ?? null;
    }
  }

  async getSubscriptions(apiKey: string, rcProjectId: string, customerId: string): Promise<RcApiSubscription[]> {
    const res = await this.get<{ items: RcApiSubscription[] }>(
      apiKey,
      `/v2/projects/${encodeURIComponent(rcProjectId)}/customers/${encodeURIComponent(customerId)}/subscriptions`,
    );
    return res.items ?? [];
  }
}
```

`backend/src/revenuecat/rc-backfill.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileWriter } from '../ingestion/profile-writer';
import { RcApiClient, RcApiSubscription } from './rc-api.client';
import { RcIdentityService } from './rc-identity.service';
import { profileOpsFor } from './rc-event-mapper';

/** RC API status → our status (spec §4.6; state only, never CH events). */
function mapApiStatus(sub: RcApiSubscription): 'trial' | 'active' | 'grace' | 'paused' | 'churned' {
  switch (sub.status) {
    case 'trialing': return 'trial';
    case 'active': return 'active';
    case 'in_grace_period': case 'in_billing_retry': return 'grace';
    case 'paused': return 'paused';
    default: return sub.gives_access ? 'active' : 'churned';
  }
}

@Injectable()
export class RcBackfillService {
  private readonly logger = new Logger(RcBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: RcApiClient,
    private readonly identity: RcIdentityService,
    private readonly profileWriter: ProfileWriter,
  ) {}

  async run(projectId: string, nowMs = Date.now()): Promise<void> {
    const integration = await this.prisma.revenueCatIntegration.findUnique({ where: { projectId } });
    if (!integration) return;
    if (!integration.apiKey || !integration.rcProjectId) {
      await this.setStatus(projectId, 'failed: missing credentials');
      return;
    }
    await this.setStatus(projectId, 'running');
    try {
      for await (const customers of this.client.listCustomers(integration.apiKey, integration.rcProjectId)) {
        for (const customer of customers) {
          await this.syncCustomer(projectId, integration.apiKey, integration.rcProjectId, customer.id, nowMs);
        }
      }
      await this.setStatus(projectId, 'done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`backfill failed for ${projectId}: ${msg}`);
      await this.setStatus(projectId, `failed: ${msg}`.slice(0, 500));
    }
  }

  /** Also used by the per-user refresh endpoint. */
  async syncCustomer(
    projectId: string,
    apiKey: string,
    rcProjectId: string,
    rcAppUserId: string,
    nowMs = Date.now(),
  ): Promise<void> {
    const subs = await this.client.getSubscriptions(apiKey, rcProjectId, rcAppUserId);
    if (subs.length === 0) return;
    const current = subs.find((s) => s.gives_access) ?? subs[0];
    const distinctId = await this.identity.resolveDistinctId(projectId, rcAppUserId);
    const state = await this.prisma.subscriptionState.upsert({
      where: { projectId_rcAppUserId: { projectId, rcAppUserId } },
      create: {
        projectId, rcAppUserId, distinctId,
        status: mapApiStatus(current),
        productId: current.product_id, store: current.store, periodType: null,
        priceCents: null, currency: 'USD',
        mrrCents: 0,
        totalSpentCents: Math.round((current.total_revenue_in_usd?.gross ?? 0) * 100),
        firstPurchaseAt: null,
        expiresAt: current.current_period_ends_at ? new Date(current.current_period_ends_at) : null,
        cancelledAt: null, lastEventAt: new Date(nowMs),
      },
      update: {
        ...(distinctId !== null ? { distinctId } : {}),
        status: mapApiStatus(current),
        productId: current.product_id, store: current.store,
        expiresAt: current.current_period_ends_at ? new Date(current.current_period_ends_at) : null,
        lastEventAt: new Date(nowMs),
      },
    });
    if (distinctId !== null) {
      await this.profileWriter.apply(projectId, profileOpsFor(distinctId, state, nowMs), nowMs);
    }
  }

  private async setStatus(projectId: string, backfillStatus: string): Promise<void> {
    await this.prisma.revenueCatIntegration.update({ where: { projectId }, data: { backfillStatus } });
  }
}
```

Add to `rc-admin.controller.ts`:

```ts
@Post('resync')
@HttpCode(202)
@UseGuards(ProjectRolesGuard)
@ProjectRoles('admin')
resync(@Param('projectId') projectId: string) {
  void this.backfill.run(projectId); // fire-and-forget: no scheduler exists (Global Constraints)
  return { status: 'started' };
}

@Post('users/:distinctId/refresh')
@UseGuards(ProjectRolesGuard)
@ProjectRoles('analyst')
async refreshUser(
  @Req() req: AuthRequest,
  @Param('projectId') projectId: string,
  @Param('distinctId') distinctId: string,
) {
  const integration = await this.service.requireIntegrationWithKey(projectId); // throws 404/409 helpers in service
  const state = await this.service.requireStateByDistinctId(projectId, distinctId);
  await this.backfill.syncCustomer(projectId, integration.apiKey, integration.rcProjectId, state.rcAppUserId);
  return this.service.getUserSubscription(req.user!.id, projectId, distinctId);
}
```

with two small `RcAdminService` helpers (`requireIntegrationWithKey` → NotFound when no row, Conflict/BadRequest when `apiKey`/`rcProjectId` null; `requireStateByDistinctId` → NotFound when no state), plus inject `RcBackfillService` into the controller and register `RcApiClient` + `RcBackfillService` in `revenuecat.module.ts` providers. Also call `void this.backfill.run(projectId)` at the end of `RcAdminService.upsert` **when the create path ran AND an api key was provided** (spec: backfill on connect). Extend the Task 7 controller metadata spec's role table with `['resync', 'admin']` and `['refreshUser', 'analyst']`.

- [ ] **Step 5: Run the whole revenuecat suite + typecheck**

Run: `cd backend && npx jest src/revenuecat && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/revenuecat
git commit -m "feat(backend): revenuecat api client, connect-time backfill, resync + per-user refresh"
```

---

# Phase 2 — Analytics extensions

### Task 9: `target: 'profile'` filters in the shared filter compiler

**Files:**
- Modify: `backend/src/analytics/insights-query.schema.ts` (`insightsFilterSchema`)
- Modify: `backend/src/analytics/filter-compiler.ts` (`compileFilter`)
- Test: extend `backend/src/analytics/filter-compiler.spec.ts` and `backend/src/analytics/insights-query.schema.spec.ts`

**Interfaces:**
- Produces: any filter may carry `target?: 'event' | 'profile'` (default `'event'` — existing behavior byte-for-byte). Profile filters compile to `e.distinct_id IN (SELECT distinct_id FROM user_profiles FINAL WHERE project_id = {projectId:UUID} AND <predicate>)`.
- **Precondition (document in code):** every host query that passes filters through `compileFilterClauses` already binds `{projectId:UUID}` — all current call sites do (verify with `grep -rn "compileFilterClauses" backend/src/analytics | xargs grep -l "projectId"`).
- **Known limitation (document in code + spec already notes it):** the subquery matches on `e.distinct_id`, so an identified user's pre-identify anon events don't match profile filters. Consistent with `applyCohortPredicate`.

- [ ] **Step 1: Add failing schema + compiler tests**

Append to `insights-query.schema.spec.ts`:

```ts
it('accepts target profile on a filter and defaults to undefined', () => {
  const f = insightsFilterSchema.parse({ property: '$rc_status', op: 'eq', value: 'active', target: 'profile' });
  expect(f.target).toBe('profile');
  expect(insightsFilterSchema.parse({ property: 'os', op: 'eq', value: 'ios' }).target).toBeUndefined();
});
it('rejects an unknown target', () => {
  expect(insightsFilterSchema.safeParse({ property: 'x', op: 'eq', value: 'y', target: 'nope' }).success).toBe(false);
});
```

Append to `filter-compiler.spec.ts` (mirror the file's existing test style for params assertions):

```ts
describe('profile-target filters', () => {
  it('compiles eq to a user_profiles IN-subquery with bound key and value', () => {
    const params: Record<string, unknown> = {};
    const [clause] = compileFilterClauses(
      [{ property: '$rc_status', op: 'eq', value: 'active', target: 'profile' }], params);
    expect(clause).toContain('e.distinct_id IN (');
    expect(clause).toContain('FROM user_profiles FINAL');
    expect(clause).toContain('project_id = {projectId:UUID}');
    expect(clause).not.toContain('active'); // value must be bound, not inlined
    expect(Object.values(params)).toEqual(expect.arrayContaining(['$rc_status', 'active']));
  });
  it('supports is_set / is_not_set on profile properties', () => {
    const params: Record<string, unknown> = {};
    const [clause] = compileFilterClauses(
      [{ property: '$rc_status', op: 'is_set', target: 'profile' }], params);
    expect(clause).toContain("!= ''");
  });
  it('leaves event-target filters untouched (default path unchanged)', () => {
    const params: Record<string, unknown> = {};
    const withTarget = compileFilterClauses([{ property: 'os', op: 'eq', value: 'ios', target: 'event' }], params);
    const without = compileFilterClauses([{ property: 'os', op: 'eq', value: 'ios' }], { });
    expect(withTarget[0]).toBe(without[0]);
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && npx jest src/analytics/filter-compiler.spec.ts src/analytics/insights-query.schema.spec.ts`
Expected: FAIL — `target` rejected by schema / clause not an IN-subquery.

- [ ] **Step 3: Implement**

`insights-query.schema.ts` — add to `insightsFilterSchema`'s object (before the existing `.refine`):

```ts
target: z.enum(['event', 'profile']).optional(),
```

`filter-compiler.ts` — inside `compileFilter` (or the per-filter branch of `compileFilterClauses`), FIRST branch on target:

```ts
if (filter.target === 'profile') {
  return compileProfileFilter(filter, paramName, params);
}
```

and add:

```ts
/**
 * Profile-target filters (RevenueCat spec §4.5 amendment): predicate over
 * user_profiles.properties as a distinct_id IN-subquery, same shape as
 * applyCohortPredicate. PRECONDITION: the host query binds {projectId:UUID}.
 * Limitation: matches e.distinct_id — pre-identify anon rows won't match.
 */
function compileProfileFilter(
  filter: InsightsFilter,
  paramName: string,
  params: Record<string, unknown>,
): string {
  const keyParam = `${paramName}_pk`;
  params[keyParam] = filter.property;
  const str = `JSONExtractString(toJSONString(properties), {${keyParam}:String})`;
  const num = `JSONExtractFloat(toJSONString(properties), {${keyParam}:String})`;
  let predicate: string;
  switch (filter.op) {
    case 'is_set':      predicate = `${str} != ''`; break;
    case 'is_not_set':  predicate = `${str} = ''`; break;
    case 'contains': {
      const v = `${paramName}_pv`; params[v] = String(filter.value);
      predicate = `position(${str}, {${v}:String}) > 0`; break;
    }
    case 'gt': case 'lt': {
      const v = `${paramName}_pv`; params[v] = Number(filter.value);
      predicate = `${num} ${filter.op === 'gt' ? '>' : '<'} {${v}:Float64}`; break;
    }
    default: { // eq / neq
      const v = `${paramName}_pv`; params[v] = String(filter.value);
      predicate = `${str} ${filter.op === 'neq' ? '!=' : '='} {${v}:String}`; break;
    }
  }
  return `e.distinct_id IN (SELECT distinct_id FROM user_profiles FINAL WHERE project_id = {projectId:UUID} AND ${predicate})`;
}
```

Match the file's real internals: reuse its existing param-naming helper (`paramName` comes from the same `${namePrefix}${index}` scheme), its `InsightsFilter` import, and whatever cast helpers it already has if they fit. Keep the default event path literally untouched.

- [ ] **Step 4: Run the FULL analytics suite (regression gate)**

Run: `cd backend && npx jest src/analytics && npm run typecheck`
Expected: PASS — every pre-existing compiler test must be green (default path unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/src/analytics
git commit -m "feat(backend): profile-target filters compile to user_profiles IN-subquery"
```

---

### Task 10: `profile` cohort condition type

**Files:**
- Modify: `backend/src/cohorts/cohort.schema.ts` (add variant)
- Modify: `backend/src/cohorts/cohort.compiler.ts` (compile it)
- Test: extend `backend/src/cohorts/` existing schema + compiler specs (find exact filenames with `ls backend/src/cohorts`)

**Interfaces:**
- Produces: `CohortCondition` union gains `{ type: 'profile', property: string(1..255), op: FilterOp, value?: FilterValue }`, compiled to `SELECT distinct_id FROM user_profiles FINAL WHERE project_id = {projectId:UUID} AND <predicate>` — composing with `match: all|any` INTERSECT/UNION exactly like the other condition subqueries. Existing condition types byte-for-byte unchanged. Used by Task 11 auto-cohorts and the dashboard cohort builder later.

- [ ] **Step 1: Add failing tests**

Schema spec:

```ts
it('accepts a profile condition', () => {
  const def = cohortDefinitionSchema.parse({
    match: 'all',
    conditions: [{ type: 'profile', property: '$rc_status', op: 'eq', value: 'active' }],
  });
  expect(def.conditions[0]).toMatchObject({ type: 'profile', property: '$rc_status' });
});
```

Compiler spec (mirror existing behavior-condition test style):

```ts
it('compiles a profile condition to a user_profiles subquery with bound params', () => {
  const { sql, params } = compileCohort(
    { match: 'all', conditions: [{ type: 'profile', property: '$rc_status', op: 'eq', value: 'active' }] },
    PROJECT_ID,
  );
  expect(sql).toContain('FROM user_profiles FINAL');
  expect(sql).not.toContain('active');
  expect(Object.values(params)).toEqual(expect.arrayContaining(['$rc_status', 'active']));
});
```

(Adapt `compileCohort`'s exact signature/return from the existing spec file — it may take `{ now }` opts and prefix params `c0…`.)

- [ ] **Step 2: Run to verify failures**

Run: `cd backend && npx jest src/cohorts`
Expected: FAIL — unknown condition type.

- [ ] **Step 3: Implement**

`cohort.schema.ts`: add to the discriminated union:

```ts
z.object({
  type: z.literal('profile'),
  property: z.string().trim().min(1).max(255),
  op: z.enum(FILTER_OPS),
  value: filterValueSchema.optional(),
}).refine((c) => c.op === 'is_set' || c.op === 'is_not_set' || c.value !== undefined, {
  message: 'value required for this operator',
}),
```

(reusing the same `FILTER_OPS`/`filterValueSchema` imports the file already uses for condition filters).

`cohort.compiler.ts`: add a `case 'profile':` next to the existing per-condition switch, emitting (with the file's param-prefix scheme, e.g. `c${index}_pk`/`c${index}_pv`):

```ts
`SELECT distinct_id FROM user_profiles FINAL
 WHERE project_id = {projectId:UUID} AND ${predicate}`
```

where `predicate` is built with the same op→SQL mapping as Task 9's `compileProfileFilter` (extract a tiny shared helper into `backend/src/analytics/filter-compiler.ts` and export it — `profilePropertyPredicate(property, op, value, keyParam, valueParam, params): string` — so Task 9 and this task share one implementation; refactor Task 9's function to use it).

- [ ] **Step 4: Run cohorts + analytics suites**

Run: `cd backend && npx jest src/cohorts src/analytics && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/cohorts backend/src/analytics
git commit -m "feat(backend): profile cohort condition over user_profiles"
```

---

### Task 11: Auto-created cohorts on connect

**Files:**
- Modify: `backend/src/revenuecat/rc-admin.service.ts` (+ constructor: `CohortsService`)
- Modify: `backend/src/revenuecat/revenuecat.module.ts` (import the module exporting `CohortsService`)
- Modify: `backend/src/revenuecat/rc-admin.controller.ts` (pass `req.user!.id` into `upsert`)
- Test: extend `backend/src/revenuecat/rc-admin.service.spec.ts`

**Interfaces:**
- Consumes: `CohortsService.create(projectId, userId, { name, definition })` (Task 10's `profile` conditions).
- Produces: first-time connect creates 4 cohorts (skip any whose name already exists): **RC: Active subscribers** (`$rc_status eq active`), **RC: In trial** (`trial`), **RC: Churned** (`churned`), **RC: Billing issue** (`grace`).

- [ ] **Step 1: Add failing tests to `rc-admin.service.spec.ts`**

```ts
it('creates the four RC cohorts on first connect, skipping existing names', async () => {
  const { svc, cohorts } = build(); // extend build(): cohorts = { create: jest.fn(), listNames: ... }
  await svc.upsert(PID, { api_key: 'k' }, 'user-1');
  const names = cohorts.create.mock.calls.map((c: any) => c[2].name);
  expect(names).toEqual([
    'RC: Active subscribers', 'RC: In trial', 'RC: Churned', 'RC: Billing issue',
  ]);
  expect(cohorts.create.mock.calls[0][2].definition).toEqual({
    match: 'all',
    conditions: [{ type: 'profile', property: '$rc_status', op: 'eq', value: 'active' }],
  });
});

it('does not create cohorts when the integration already existed', async () => {
  const { svc, cohorts } = build({ integration: ROW });
  await svc.upsert(PID, { sandbox_mode: true }, 'user-1');
  expect(cohorts.create).not.toHaveBeenCalled();
});
```

(Extend the spec's `build()` to inject a `cohorts` mock and to make `upsert` detect create-vs-update via the pre-existing `findUnique` mock. `svc.upsert` gains a third `userId` param — update earlier upsert tests accordingly.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/revenuecat/rc-admin.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `RcAdminService.upsert(projectId, input, userId)`: check existence first (`findUnique`); after a create-path upsert, call:

```ts
private static readonly AUTO_COHORTS: Array<{ name: string; value: string }> = [
  { name: 'RC: Active subscribers', value: 'active' },
  { name: 'RC: In trial', value: 'trial' },
  { name: 'RC: Churned', value: 'churned' },
  { name: 'RC: Billing issue', value: 'grace' },
];

private async createAutoCohorts(projectId: string, userId: string): Promise<void> {
  const existing = await this.prisma.cohort.findMany({
    where: { projectId }, select: { name: true },
  });
  const taken = new Set(existing.map((c) => c.name));
  for (const { name, value } of RcAdminService.AUTO_COHORTS) {
    if (taken.has(name)) continue;
    await this.cohorts.create(projectId, userId, {
      name,
      definition: {
        match: 'all',
        conditions: [{ type: 'profile', property: '$rc_status', op: 'eq', value }],
      },
    });
  }
}
```

Controller `upsert` passes `req.user!.id`. Module imports `CohortsModule` (it exports `CohortsService`).

- [ ] **Step 4: Run suites**

Run: `cd backend && npx jest src/revenuecat && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/revenuecat
git commit -m "feat(backend): auto-create RC subscription cohorts on connect"
```

---

### Task 12: `GET metrics/subscriptions` (Subscriptions page data)

**Files:**
- Create: `backend/src/revenuecat/rc-metrics.controller.ts`
- Create: `backend/src/revenuecat/rc-metrics.service.ts`
- Modify: `backend/src/revenuecat/revenuecat.module.ts`
- Test: `backend/src/revenuecat/rc-metrics.service.spec.ts`, `backend/src/revenuecat/rc-metrics.controller.spec.ts`

**Interfaces:**
- Consumes: `ProjectsService.assertMembership`; `resolveDateOnlyRange`, `parseFiltersParam` from `backend/src/analytics/read-query.util`; `compileFilterClauses`; `toChDateTime64`, `parseDateOnlyUTC`-style helpers exactly as `getRevenueSummary` uses them (`backend/src/analytics/analytics.service.ts:695-789` is the template — copy its param/date plumbing verbatim).
- Produces: `GET /api/v1/projects/:projectId/metrics/subscriptions?from&to&filters` → `SubscriptionsSummaryResponse` (JWT + assertMembership; 404 problem when the project has no integration row):

```ts
export interface SubscriptionsSummaryResponse {
  mrr_cents: number;               // Postgres: sum(mrrCents) where status='active'  — CURRENT state, unfiltered
  active: number;                  // Postgres counts by status — CURRENT state, unfiltered
  in_trial: number;
  grace: number;
  new_subscriptions: number;       // CH, in range, respects `filters`
  churned: number;                 // CH $rc_expiration count in range
  trials_started: number;          // CH $rc_initial_purchase with $rc_period_type='TRIAL'
  trials_converted: number;        // CH users whose FIRST $rc_renewal falls in range after a TRIAL start
  by_day: Array<{ t: string; new_subscriptions: number; churned: number; revenue: number }>;
  by_product: Array<{ product_id: string; active: number; mrr_cents: number }>;   // Postgres groupBy
  by_store: Array<{ store: string; active: number }>;                              // Postgres groupBy
  churn_reasons: Array<{ reason: string; count: number }>;                         // CH $rc_expiration/$rc_cancellation reasons
  recent_events: Array<{ insert_id: string; event: string; distinct_id: string; timestamp: string; product_id: string; price: number }>;
}
```
- Current-state KPIs (mrr/active/in_trial/grace, by_product, by_store) come from `SubscriptionState` and are **not** affected by `filters`/date range — the dashboard marks those tiles `unfiltered` (KpiTile prop exists for exactly this).

- [ ] **Step 1: Write failing service spec `rc-metrics.service.spec.ts`**

```ts
import { RcMetricsService } from './rc-metrics.service';

const PID = '0197f6a0-0000-7000-8000-0000000000aa';

function build({ integration = { id: 'int-1' } as unknown }: { integration?: unknown } = {}) {
  const prisma = {
    revenueCatIntegration: { findUnique: jest.fn(async () => integration) },
    subscriptionState: {
      groupBy: jest.fn(async ({ by }: any) =>
        by[0] === 'status'
          ? [{ status: 'active', _count: { _all: 5 }, _sum: { mrrCents: 4995 } },
             { status: 'trial', _count: { _all: 2 }, _sum: { mrrCents: 0 } }]
          : by[0] === 'productId'
            ? [{ productId: 'pro_monthly', _count: { _all: 5 }, _sum: { mrrCents: 4995 } }]
            : [{ store: 'APP_STORE', _count: { _all: 5 } }]),
    },
  } as any;
  const clickhouse = { query: jest.fn(async () => []) } as any;
  const projects = { assertMembership: jest.fn(async () => undefined) } as any;
  return { prisma, clickhouse, projects, svc: new RcMetricsService(prisma, clickhouse, projects) };
}

describe('RcMetricsService.getSummary', () => {
  it('404s when the project has no integration', async () => {
    const { svc } = build({ integration: null });
    await expect(svc.getSummary('u1', PID)).rejects.toMatchObject({
      // match the codebase problem-details error style used for 404s in analytics.service.ts
      status: 404,
    });
  });

  it('asserts membership and aggregates state KPIs from Postgres', async () => {
    const { svc, projects } = build();
    const s = await svc.getSummary('u1', PID);
    expect(projects.assertMembership).toHaveBeenCalledWith('u1', PID);
    expect(s.active).toBe(5);
    expect(s.in_trial).toBe(2);
    expect(s.mrr_cents).toBe(4995);
    expect(s.by_product).toEqual([{ product_id: 'pro_monthly', active: 5, mrr_cents: 4995 }]);
  });

  it('binds project + range params on every CH query and never interpolates', async () => {
    const { svc, clickhouse } = build();
    await svc.getSummary('u1', PID, '2026-07-01', '2026-07-10');
    for (const [sql, params] of clickhouse.query.mock.calls) {
      expect(sql).toContain('{projectId:UUID}');
      expect(params.projectId).toBe(PID);
    }
  });
});
```

(Align the 404 assertion with how `analytics.service.spec.ts` asserts NotFound — copy its exact `rejects.toMatchObject` shape.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/revenuecat/rc-metrics.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement service + controller**

`rc-metrics.service.ts` skeleton (copy `getRevenueSummary`'s date/filter plumbing verbatim from `analytics.service.ts:695`; reserved names as module-local literals):

```ts
const RC_INITIAL = '$rc_initial_purchase';
const RC_RENEWAL = '$rc_renewal';
const RC_EXPIRATION = '$rc_expiration';
const RC_CANCELLATION = '$rc_cancellation';
const RC_NON_RENEWING = '$rc_non_renewing_purchase';
const PRICE_EXPR = "JSONExtractFloat(toJSONString(properties), '$price')";
const PERIOD_EXPR = "JSONExtractString(toJSONString(properties), '$rc_period_type')";
```

Method `getSummary(userId, projectId, fromRaw?, toRaw?, filtersRaw?)`:
1. `assertMembership`; `revenueCatIntegration.findUnique` → throw the codebase's standard 404 problem when null.
2. Postgres: `subscriptionState.groupBy({ by: ['status'], where: { projectId }, _count: { _all: true }, _sum: { mrrCents: true } })` → `active/in_trial/grace/mrr_cents`; `groupBy(['productId'])` where status `active` → `by_product`; `groupBy(['store'])` where status `active` → `by_store`.
3. CH (all with `resolveDateOnlyRange` + `compileFilterClauses(parseFiltersParam(filtersRaw), params)` plumbing copied from the revenue template, `Promise.all`):
   - `new_subscriptions` + `trials_started`: `SELECT countIf(${PERIOD_EXPR} != 'TRIAL') AS subs, countIf(${PERIOD_EXPR} = 'TRIAL') AS trials FROM events AS e WHERE e.project_id = {projectId:UUID} AND e.event = '${RC_INITIAL}' AND …range… ${filterAndClause}`
   - `churned`: count of `'${RC_EXPIRATION}'` in range.
   - `trials_converted`: `SELECT uniqExact(distinct_id) FROM (SELECT distinct_id, min(timestamp) AS first_renewal FROM events WHERE project_id={projectId:UUID} AND event='${RC_RENEWAL}' GROUP BY distinct_id) WHERE first_renewal >= {from:DateTime64} AND first_renewal < {toExclusive:DateTime64} AND distinct_id IN (SELECT distinct_id FROM events WHERE project_id={projectId:UUID} AND event='${RC_INITIAL}' AND ${PERIOD_EXPR} = 'TRIAL')`
   - `by_day`: `SELECT toDate(timestamp) AS t, countIf(event = '${RC_INITIAL}') AS new_subscriptions, countIf(event = '${RC_EXPIRATION}') AS churned, sumIf(${PRICE_EXPR}, event IN ('${RC_INITIAL}','${RC_RENEWAL}','${RC_NON_RENEWING}')) AS revenue FROM events AS e WHERE …project+range+filters… AND event LIKE '$rc\\_%' GROUP BY t ORDER BY t`
   - `churn_reasons`: `SELECT coalesce(nullif(JSONExtractString(toJSONString(properties), '$rc_expiration_reason'), ''), nullif(JSONExtractString(toJSONString(properties), '$rc_cancel_reason'), ''), 'UNKNOWN') AS reason, count() AS count FROM events AS e WHERE …project+range… AND event IN ('${RC_EXPIRATION}','${RC_CANCELLATION}') GROUP BY reason ORDER BY count DESC`
   - `recent_events`: latest 20 `event LIKE '$rc\\_%'` with `$product_id`/`$price` extracted.
4. Guard all ratio math with zero-divisor checks (NaN is invalid JSON — revenue-template rule).

`rc-metrics.controller.ts` — mirror `AnalyticsController.revenueSummary` exactly (JWT class guard, `@Get('metrics/subscriptions')` on `@Controller('api/v1/projects/:projectId')`); controller spec asserts JWT metadata + delegation (copy the Task 5 controller-spec style). Register in module.

- [ ] **Step 4: Run suites**

Run: `cd backend && npx jest src/revenuecat && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/revenuecat
git commit -m "feat(backend): subscriptions metrics endpoint (mrr, lifecycle, breakdowns, churn reasons)"
```

---

### Task 13: `GET metrics/subscriptions/attribution` (conversion drivers, time-to-convert, trial funnel)

**Files:**
- Modify: `backend/src/revenuecat/rc-metrics.controller.ts`, `rc-metrics.service.ts`
- Test: extend `backend/src/revenuecat/rc-metrics.service.spec.ts`

**Interfaces:**
- Produces: `GET /api/v1/projects/:projectId/metrics/subscriptions/attribution?from&to` → 

```ts
export interface SubscriptionAttributionResponse {
  drivers: Array<{ event: string; users: number }>;        // top 20 non-$rc events in the 7d before first purchase
  screens: Array<{ screen_name: string; users: number }>;  // top 20 screens in the same window
  time_to_convert: Array<{ bucket: string; users: number }>; // '<1d','1-3d','3-7d','7-14d','14-30d','30d+'
  trial_funnel: { trials: number; converted: number };
}
```

- [ ] **Step 1: Add failing tests**

```ts
describe('RcMetricsService.getAttribution', () => {
  it('404s without an integration and asserts membership with one', async () => {
    const a = build({ integration: null });
    await expect(a.svc.getAttribution('u1', PID)).rejects.toMatchObject({ status: 404 });
    const b = build();
    await b.svc.getAttribution('u1', PID);
    expect(b.projects.assertMembership).toHaveBeenCalledWith('u1', PID);
  });

  it('shapes empty CH results into empty arrays and zeroed funnel', async () => {
    const { svc } = build();
    const r = await svc.getAttribution('u1', PID);
    expect(r).toEqual({ drivers: [], screens: [], time_to_convert: [], trial_funnel: { trials: 0, converted: 0 } });
  });

  it('excludes $rc events from drivers and bounds the pre-purchase window', async () => {
    const { svc, clickhouse } = build();
    await svc.getAttribution('u1', PID);
    const driversSql = clickhouse.query.mock.calls.map((c: any) => c[0]).find((s: string) => s.includes('NOT LIKE'));
    expect(driversSql).toContain("NOT LIKE '$rc%'");
    expect(driversSql).toContain('INTERVAL 7 DAY');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/revenuecat/rc-metrics.service.spec.ts`
Expected: FAIL — `getAttribution` missing.

- [ ] **Step 3: Implement `getAttribution(userId, projectId, fromRaw?, toRaw?)`**

Same guards/range plumbing as `getSummary`. Four CH queries (`Promise.all`):

Drivers:
```sql
WITH first_purchase AS (
  SELECT distinct_id, min(timestamp) AS fp
  FROM events
  WHERE project_id = {projectId:UUID} AND event = '$rc_initial_purchase'
    AND timestamp >= {from:DateTime64} AND timestamp < {toExclusive:DateTime64}
  GROUP BY distinct_id
)
SELECT e.event AS event, uniqExact(e.distinct_id) AS users
FROM events AS e
INNER JOIN first_purchase AS f ON e.distinct_id = f.distinct_id
WHERE e.project_id = {projectId:UUID}
  AND e.timestamp < f.fp AND e.timestamp >= f.fp - INTERVAL 7 DAY
  AND e.event NOT LIKE '$rc%'
GROUP BY e.event ORDER BY users DESC LIMIT 20
```

Screens: same CTE, `AND e.event = '$screen_view'`, `SELECT JSONExtractString(toJSONString(e.properties), '$screen_name') AS screen_name`, group by it, drop empty names (`HAVING screen_name != ''`).

Time-to-convert:
```sql
WITH first_purchase AS ( …same… ),
first_seen AS (
  SELECT distinct_id, min(timestamp) AS fs FROM events
  WHERE project_id = {projectId:UUID} GROUP BY distinct_id
)
SELECT multiIf(d < 1, '<1d', d < 3, '1-3d', d < 7, '3-7d', d < 14, '7-14d', d < 30, '14-30d', '30d+') AS bucket,
       count() AS users
FROM (
  SELECT dateDiff('day', s.fs, f.fp) AS d
  FROM first_purchase AS f INNER JOIN first_seen AS s ON f.distinct_id = s.distinct_id
)
GROUP BY bucket
```
(Sort the buckets in TS by the fixed bucket order, not SQL.)

Trial funnel:
```sql
WITH trial_starts AS (
  SELECT DISTINCT distinct_id FROM events
  WHERE project_id = {projectId:UUID} AND event = '$rc_initial_purchase'
    AND JSONExtractString(toJSONString(properties), '$rc_period_type') = 'TRIAL'
    AND timestamp >= {from:DateTime64} AND timestamp < {toExclusive:DateTime64}
)
SELECT count() AS trials,
       countIf(distinct_id IN (SELECT DISTINCT distinct_id FROM events
         WHERE project_id = {projectId:UUID} AND event = '$rc_renewal')) AS converted
FROM trial_starts
```

Controller: `@Get('metrics/subscriptions/attribution')`, same guard shape as Task 12.

- [ ] **Step 4: Run + typecheck**

Run: `cd backend && npx jest src/revenuecat && npm run typecheck && npm test`
Expected: PASS — full backend suite green (Phase 1+2 done).

- [ ] **Step 5: Commit**

```bash
git add backend/src/revenuecat
git commit -m "feat(backend): subscription attribution endpoint (drivers, time-to-convert, trial funnel)"
```

---

# Phase 3 — Flutter SDK

### Task 14: `MyAmpix.getDistinctId()`

**Files:**
- Modify: `sdk/flutter_analytics/lib/src/myampix.dart`
- Test: extend `sdk/flutter_analytics/test/myampix_test.dart`

**Interfaces:**
- Produces: `String? getDistinctId()` on the `MyAmpix` facade — `null` before `init`, else the current distinct id (synchronous read; `IdentityManager.distinctId` is an in-memory getter). Enables the documented convention recipe `Purchases.logIn(MyAmpix.instance.getDistinctId()!)`.

- [ ] **Step 1: Write the failing test (facade harness — reuse `initSdk` helper at `test/myampix_test.dart:96-109`)**

```dart
test('getDistinctId returns null before init and the identified id after identify', () async {
  expect(MyAmpix.instance.getDistinctId(), isNull);
  await initSdk();
  final anon = MyAmpix.instance.getDistinctId();
  expect(anon, isNotNull);
  MyAmpix.instance.identify('user-42');
  await waitFor(() => MyAmpix.instance.getDistinctId() == 'user-42');
});
```

(Place it before any test that already initializes the SDK, or run inside the file's standard setUp/tearDown that calls `shutdownForTesting` — copy the surrounding tests' structure so instance state doesn't leak.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd sdk/flutter_analytics && flutter test test/myampix_test.dart`
Expected: FAIL — `getDistinctId` not defined.

- [ ] **Step 3: Implement on the facade (`myampix.dart`, next to `identify` at ~:502)**

```dart
/// The current distinct id, or null before [init] completes its identity load.
/// Pass this to other SDKs (e.g. RevenueCat's `Purchases.logIn`) to share identity.
String? getDistinctId() {
  if (!_initialized) return null;
  return _identity.distinctId;
}
```

(Use the facade's real initialized-flag/field names — whatever `_guard` checks at `:584-587`.)

- [ ] **Step 4: Run the SDK suite**

Run: `cd sdk/flutter_analytics && flutter test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sdk/flutter_analytics
git commit -m "feat(sdk): expose getDistinctId for cross-SDK identity sharing"
```

---

### Task 15: `setRevenueCatAppUserId` + `$rc_link` lifecycle

**Files:**
- Create: `sdk/flutter_analytics/lib/src/identity/rc_link_store.dart`
- Modify: `sdk/flutter_analytics/lib/src/myampix.dart` (`_start`, new method, `identify`, `reset`)
- Test: `sdk/flutter_analytics/test/identity/rc_link_store_test.dart`, extend `test/myampix_test.dart`

**Interfaces:**
- Consumes: `KeyValueStore` (`getString/setString/remove`); `_pipeline.track(event, [properties])` (positional props); `_guard` ordering chain; template: `SuperPropertiesStore` + `_recordCampaignTouch` (persist first, then track).
- Produces:
  - `RcLinkStore` — `RcLinkStore({required KeyValueStore store})`, `static const storageKey = 'mam_rc_app_user_id'`, `Future<void> load()`, `String? get value`, `Future<void> set(String id)`, `Future<void> clear()`.
  - Facade `void setRevenueCatAppUserId(String id)` — guarded: persist, then emit `$rc_link` with `{'$rc_app_user_id': id}`.
  - `identify()` re-emits `$rc_link` after `$identify` when a link is persisted (webhook events follow the new identity, spec §5).
  - `reset()` clears the stored id (no `$rc_link` emitted on reset).

- [ ] **Step 1: Write the failing store test `test/identity/rc_link_store_test.dart`**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/src/identity/rc_link_store.dart';
import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('persists, survives reload, and clears', () async {
    final kv = InMemoryKeyValueStore();
    final store = RcLinkStore(store: kv);
    await store.load();
    expect(store.value, isNull);

    await store.set('rc-user-1');
    expect(store.value, 'rc-user-1');
    expect(kv.values[RcLinkStore.storageKey], 'rc-user-1');

    final relaunched = RcLinkStore(store: kv);
    await relaunched.load();
    expect(relaunched.value, 'rc-user-1');

    await relaunched.clear();
    expect(relaunched.value, isNull);
    expect(kv.values.containsKey(RcLinkStore.storageKey), isFalse);
  });
}
```

- [ ] **Step 2: Write the failing facade tests (extend `test/myampix_test.dart`, using `initSdk`/`sentEvents`/`waitFor`)**

```dart
test(r'setRevenueCatAppUserId persists and emits $rc_link', () async {
  await initSdk();
  MyAmpix.instance.setRevenueCatAppUserId('rc-user-1');
  await waitFor(() => sentEvents().any((e) => e['event'] == r'$rc_link'));
  final link = sentEvents().lastWhere((e) => e['event'] == r'$rc_link');
  expect(link['properties'][r'$rc_app_user_id'], 'rc-user-1');
});

test(r'identify re-emits $rc_link on the new identity', () async {
  await initSdk();
  MyAmpix.instance.setRevenueCatAppUserId('rc-user-1');
  await waitFor(() => sentEvents().any((e) => e['event'] == r'$rc_link'));
  MyAmpix.instance.identify('user-42');
  await waitFor(() => sentEvents()
      .where((e) => e['event'] == r'$rc_link')
      .any((e) => e['distinct_id'] == 'user-42'));
});

test(r'reset clears the RC link and identify afterwards emits no $rc_link', () async {
  await initSdk();
  MyAmpix.instance.setRevenueCatAppUserId('rc-user-1');
  await waitFor(() => sentEvents().any((e) => e['event'] == r'$rc_link'));
  final before = sentEvents().where((e) => e['event'] == r'$rc_link').length;
  MyAmpix.instance.reset();
  MyAmpix.instance.identify('user-99');
  await waitFor(() => sentEvents().any(
      (e) => e['event'] == r'$identify' && e['distinct_id'] == 'user-99'));
  expect(sentEvents().where((e) => e['event'] == r'$rc_link').length, before);
});
```

(Match `sentEvents()`'s real row shape — if events expose properties/distinct_id under different keys, mirror how the existing `$identify` test at `test/myampix_test.dart:165` reads them.)

- [ ] **Step 3: Run to verify failures**

Run: `cd sdk/flutter_analytics && flutter test test/identity/rc_link_store_test.dart test/myampix_test.dart`
Expected: FAIL — `rc_link_store.dart` missing / method not defined.

- [ ] **Step 4: Implement**

`lib/src/identity/rc_link_store.dart` (mirror `SuperPropertiesStore`):

```dart
import '../storage/key_value_store.dart';

/// Persists the RevenueCat app_user_id the host app declared via
/// [MyAmpix.setRevenueCatAppUserId], so `$rc_link` can be re-emitted
/// after identity changes and cleared on reset.
class RcLinkStore {
  RcLinkStore({required KeyValueStore store}) : _store = store;

  static const storageKey = 'mam_rc_app_user_id';

  final KeyValueStore _store;
  String? _value;

  String? get value => _value;

  Future<void> load() async {
    _value = await _store.getString(storageKey);
  }

  Future<void> set(String id) async {
    _value = id;
    await _store.setString(storageKey, id);
  }

  Future<void> clear() async {
    _value = null;
    await _store.remove(storageKey);
  }
}
```

`myampix.dart` changes:
1. Field + construction in `_start` right after the `keyValueStore` is built (~:171): `_rcLink = RcLinkStore(store: keyValueStore); await _rcLink!.load();`
2. Public method (next to `identify`, mirroring `_recordCampaignTouch`'s persist-then-track shape):

```dart
/// Declares the RevenueCat app_user_id for the current user so MyAmpix can
/// attach RevenueCat webhook events to this user. Safe to call on every launch.
void setRevenueCatAppUserId(String id) {
  final trimmed = id.trim();
  if (trimmed.isEmpty) return;
  _guard('setRevenueCatAppUserId', () async {
    await _rcLink?.set(trimmed);
    await _pipeline.track(r'$rc_link', {r'$rc_app_user_id': trimmed});
  });
}
```

3. In `identify()`'s guarded body (after the `$identify` emit at ~:511):

```dart
final rcId = _rcLink?.value;
if (rcId != null) {
  await _pipeline.track(r'$rc_link', {r'$rc_app_user_id': rcId});
}
```

4. In `reset()`'s guarded body (~:520, alongside `_superProperties.clear()`): `await _rcLink?.clear();`

- [ ] **Step 5: Run the full SDK suite**

Run: `cd sdk/flutter_analytics && flutter test`
Expected: PASS — including all pre-existing identity/reset tests.

- [ ] **Step 6: Commit**

```bash
git add sdk/flutter_analytics
git commit -m "feat(sdk): setRevenueCatAppUserId with persisted \$rc_link lifecycle"
```

---

# Phase 4 — Dashboard

### Task 16: API types, hooks, and MSW fixtures

**Files:**
- Modify: `dashboard/src/lib/api/types.ts` (Project.integrations, InsightsFilter.target, RC response types)
- Create: `dashboard/src/features/revenuecat/api.ts`
- Modify: `dashboard/src/test/msw/handlers.ts` (fixtures + handlers)
- Test: `dashboard/src/features/revenuecat/api.test.ts`

**Interfaces:**
- Consumes: `apiFetch` (`dashboard/src/lib/api/client.ts:114`); backend shapes from Tasks 7, 12, 13.
- Produces (used by Tasks 17–22):
  - `types.ts`: `Project.integrations?: { revenuecat: boolean }`; `InsightsFilter.target?: 'event' | 'profile'`; `RcIntegrationStatus`, `RcJournalEntry`, `UserSubscription`, `SubscriptionsSummaryResponse`, `SubscriptionAttributionResponse` — field-for-field the backend shapes (Tasks 7/12/13 Interfaces blocks).
  - `features/revenuecat/api.ts` hooks (all keyed `['revenuecat', projectId, …]`):
    - `useRcStatus(projectId, opts?: { enabled?: boolean })` → GET status
    - `useUpsertRcIntegration(projectId)` / `useDisconnectRc(projectId)` / `useRcReplay(projectId)` / `useRcResync(projectId)` — mutations invalidating `['revenuecat', projectId]` and `['projects']` (the gating flag lives on the projects list)
    - `useRcJournal(projectId, status?, opts?: { enabled?: boolean })` → GET events
    - `useSubscriptionsSummary(projectId, from, to, filters)` — same shape as `useRevenue` (`dashboard/src/features/analytics/api.ts:384`), `enabled` when range set
    - `useSubscriptionAttribution(projectId, from, to)`
    - `useUserSubscription(projectId, distinctId, enabled)` → GET users/:distinctId
    - `useRefreshUserSubscription(projectId)` — POST users/:distinctId/refresh
  - `handlers.ts`: `TEST_PROJECT` gains `integrations: { revenuecat: true }` (RC-on is the fixture default; gating-off tests override the projects handler); fixtures `RC_STATUS_FIXTURE`, `SUBSCRIPTIONS_SUMMARY_FIXTURE`, `SUBSCRIPTION_ATTRIBUTION_FIXTURE`, `USER_SUBSCRIPTION_FIXTURE` + default handlers for every route above.
  - Also export a helper used by gating tests: `export function projectsHandlerWithoutRc()` returning an `http.get('/api/v1/projects', …)` override whose project has `integrations: { revenuecat: false }`.

- [ ] **Step 1: Write the failing hook test `dashboard/src/features/revenuecat/api.test.ts`**

Follow the repo's hook-test pattern (find one with `grep -rln "renderHook\|QueryClientProvider" dashboard/src/features | head -3`; if hooks are only tested through pages, keep this file minimal):

```ts
import { describe, expect, it } from 'vitest';
import { rcBase } from './api';

describe('revenuecat api paths', () => {
  it('builds project-scoped integration paths', () => {
    expect(rcBase('p1')).toBe('/api/v1/projects/p1/integrations/revenuecat');
  });
});
```

plus (the real coverage) — a fixture-shape guard so backend/dashboard drift fails fast:

```ts
import { RC_STATUS_FIXTURE, SUBSCRIPTIONS_SUMMARY_FIXTURE } from '../../test/msw/handlers';
it('fixtures satisfy the declared types', () => {
  expect(RC_STATUS_FIXTURE.counts).toHaveProperty('unlinked');
  expect(SUBSCRIPTIONS_SUMMARY_FIXTURE.by_day).toBeInstanceOf(Array);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && npx vitest run src/features/revenuecat/api.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types, hooks, fixtures**

`features/revenuecat/api.ts` (representative excerpt — every hook follows these three shapes exactly):

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client';
import { encodeFiltersParam } from '../analytics/api'; // reuse the existing encoder
import type {
  InsightsFilter, RcIntegrationStatus, RcJournalEntry, SubscriptionAttributionResponse,
  SubscriptionsSummaryResponse, UserSubscription,
} from '../../lib/api/types';

export const rcBase = (projectId: string) => `/api/v1/projects/${projectId}/integrations/revenuecat`;
const metricsBase = (projectId: string) => `/api/v1/projects/${projectId}/metrics`;

export function useRcStatus(projectId: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['revenuecat', projectId, 'status'],
    queryFn: () => apiFetch<RcIntegrationStatus>(rcBase(projectId)),
    enabled: opts.enabled ?? true,
  });
}

export function useUpsertRcIntegration(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { api_key?: string; rc_project_id?: string; sandbox_mode?: boolean }) =>
      apiFetch<RcIntegrationStatus>(rcBase(projectId), { method: 'PUT', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['revenuecat', projectId] });
      void qc.invalidateQueries({ queryKey: ['projects'] }); // gating flag
    },
  });
}

export function useSubscriptionsSummary(
  projectId: string, from: string, to: string, filters: InsightsFilter[] = [],
) {
  const filtersParam = filters.length > 0 ? `&filters=${encodeFiltersParam(filters)}` : '';
  return useQuery({
    queryKey: ['revenuecat', projectId, 'summary', from, to, JSON.stringify(filters)],
    queryFn: () => apiFetch<SubscriptionsSummaryResponse>(
      `${metricsBase(projectId)}/subscriptions?from=${from}&to=${to}${filtersParam}`),
    enabled: from.length > 0 && to.length > 0,
  });
}
```

(Write the remaining hooks by the same three patterns; `useRefreshUserSubscription`'s `mutationFn` takes `distinctId` and invalidates `['revenuecat', projectId, 'user']` keys.)

`handlers.ts` — add `integrations: { revenuecat: true }` to `TEST_PROJECT`; add fixtures with realistic non-zero data (e.g. summary: `mrr_cents: 4995, active: 5, in_trial: 2 …`, one `by_day` row, one product/store/reason row) and `http.get`/`http.put`/`http.post` handlers returning them; add `projectsHandlerWithoutRc()`.

- [ ] **Step 4: Run the dashboard suite (regression gate — TEST_PROJECT changed)**

Run: `cd dashboard && npm test`
Expected: PASS — the added `integrations` field is additive; if any snapshot-ish assertion on the project object fails, update it.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/api/types.ts dashboard/src/features/revenuecat dashboard/src/test/msw/handlers.ts
git commit -m "feat(dashboard): revenuecat api types, hooks, and test fixtures"
```

---

### Task 17: Integrations card in project settings

**Files:**
- Create: `dashboard/src/features/projects/components/IntegrationsSection.tsx`
- Modify: `dashboard/src/features/projects/components/ProjectDetailPage.tsx` (add `<Reveal>` slot)
- Test: `dashboard/src/features/projects/components/integrations-section.test.tsx`

**Interfaces:**
- Consumes: Task 16 hooks; `Card/CardHeader/CardTitle/CardDescription/CardContent`, `Input`, `Label`, `Button`, `Switch`, `Badge`, `Dialog*`, `Separator`, `useToast` from `dashboard/src/components/ui/`; `getRuntimeConfig().apiBaseUrl`; role gating via `useProjectRole` (already computed as `isAdmin` in `ProjectDetailPage.tsx:48-51`).
- Produces: `<IntegrationsSection projectId={project.id} />` rendered only `{project && isAdmin && …}` — a RevenueCat card with: disconnected → api key + rc project id inputs + Connect; connected → webhook URL (`apiBaseUrl + status.webhook_path`) + secret with Copy buttons, masked key, sandbox `Switch`, health counters + last-webhook time, backfill status, Replay/Re-sync buttons, journal list of latest failed/unlinked entries, Disconnect behind a confirm `Dialog`.

- [ ] **Step 1: Write the failing test (MSW + renderApp pattern from `revenue.test.tsx`)**

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import { authStore } from '../../../lib/auth/store'; // real path: copy from an existing settings test
import { RC_STATUS_FIXTURE, TEST_PROJECT, VALID_ACCESS_TOKEN, TEST_USER } from '../../../test/msw/handlers';

const SETTINGS_URL = `/projects/${TEST_PROJECT.id}`;

describe('IntegrationsSection', () => {
  it('shows the RevenueCat card with webhook URL and secret when connected', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(SETTINGS_URL);
    const card = await screen.findByTestId('rc-integration-card');
    expect(within(card).getByText(new RegExp(RC_STATUS_FIXTURE.webhook_secret))).toBeInTheDocument();
    expect(within(card).getByText(/webhooks\/revenuecat/)).toBeInTheDocument();
    expect(within(card).getByText(/…1234/)).toBeInTheDocument(); // masked key
  });

  it('offers the connect form when not connected', async () => {
    server.use(http.get('/api/v1/projects/:projectId/integrations/revenuecat', () =>
      HttpResponse.json({ ...RC_STATUS_FIXTURE, connected: false, webhook_secret: '' })));
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(SETTINGS_URL);
    const card = await screen.findByTestId('rc-integration-card');
    expect(within(card).getByLabelText(/secret api key/i)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  it('is absent for non-admin roles', async () => {
    server.use(http.get('/api/v1/projects', () =>
      HttpResponse.json({ projects: [{ ...TEST_PROJECT, role: 'analyst' }] })));
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(SETTINGS_URL);
    await screen.findByRole('main');
    await waitFor(() => expect(screen.queryByTestId('rc-integration-card')).not.toBeInTheDocument());
  });

  it('sends the PUT on connect', async () => {
    let putBody: unknown;
    server.use(
      http.get('/api/v1/projects/:projectId/integrations/revenuecat', () =>
        HttpResponse.json({ ...RC_STATUS_FIXTURE, connected: false, webhook_secret: '' })),
      http.put('/api/v1/projects/:projectId/integrations/revenuecat', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json(RC_STATUS_FIXTURE);
      }),
    );
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(SETTINGS_URL);
    const card = await screen.findByTestId('rc-integration-card');
    await userEvent.type(within(card).getByLabelText(/secret api key/i), 'sk_test_123');
    await userEvent.type(within(card).getByLabelText(/rc project id/i), 'proj1');
    await userEvent.click(within(card).getByRole('button', { name: /connect/i }));
    await waitFor(() => expect(putBody).toEqual({ api_key: 'sk_test_123', rc_project_id: 'proj1' }));
  });
});
```

(Fix the `authStore` import path + session-helper call by copying the top of an existing settings-page test verbatim.)

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && npx vitest run src/features/projects/components/integrations-section.test.tsx`
Expected: FAIL — no `rc-integration-card` test id.

- [ ] **Step 3: Implement `IntegrationsSection` + wire into `ProjectDetailPage`**

Component skeleton (fill in with the repo's exact Card/Input/Button idioms — copy a sibling section like the tokens section for structure):

```tsx
export function IntegrationsSection({ projectId }: { projectId: string }) {
  const { data: status, isPending } = useRcStatus(projectId);
  const upsert = useUpsertRcIntegration(projectId);
  const disconnect = useDisconnectRc(projectId);
  const replay = useRcReplay(projectId);
  const resync = useRcResync(projectId);
  const { data: journal } = useRcJournal(projectId, 'failed', { enabled: status?.connected ?? false });
  const { toast } = useToast();
  const apiBaseUrl = getRuntimeConfig().apiBaseUrl;
  // …
  return (
    <Card data-testid="rc-integration-card">
      <CardHeader>
        <CardTitle>RevenueCat</CardTitle>
        <CardDescription>
          Subscription events, revenue, and lifecycle analytics. Optional — nothing changes until you connect.
        </CardDescription>
      </CardHeader>
      <CardContent>{status?.connected ? <ConnectedPanel … /> : <ConnectForm … />}</CardContent>
    </Card>
  );
}
```

Behaviors: Copy buttons use `navigator.clipboard.writeText` + toast; sandbox `Switch` fires `upsert.mutate({ sandbox_mode: next })`; Disconnect opens a `Dialog` with explicit copy "Historical subscription data is kept; the webhook stops being accepted."; health panel shows `counts`, `last_webhook_at` (`toLocaleString`), `backfill_status`; Replay/Re-sync buttons disable while pending and toast the result. Wire into `ProjectDetailPage`'s grid inside the existing `{project && isAdmin && …}` pattern: `<Reveal index={6} className="lg:col-span-2"><IntegrationsSection projectId={project.id} /></Reveal>`.

- [ ] **Step 4: Run the test + the settings page's existing tests**

Run: `cd dashboard && npx vitest run src/features/projects`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/features/projects
git commit -m "feat(dashboard): revenuecat integrations card in project settings"
```

---

### Task 18: Subscriptions page, route, nav (gated)

**Files:**
- Create: `dashboard/src/features/analytics/components/SubscriptionsPage.tsx`
- Modify: `dashboard/src/router.tsx` (route), `dashboard/src/components/layout/nav-model.ts` (item), `dashboard/src/components/layout/NavIcon.tsx` (icon), `dashboard/src/components/layout/AppLayout.tsx` + `dashboard/src/features/command-palette/CommandPalette.tsx` (flag filtering)
- Test: `dashboard/src/features/analytics/components/subscriptions.test.tsx`

**Interfaces:**
- Consumes: `useSubscriptionsSummary` (Task 16); `useDateRange`, `useGlobalFilters` + `mergeGlobalFilters`; `PageShell`, `SectionGrid`, `KpiTile`, `ChartCard`, `ComparisonTrend`, `DonutChart`, `DataTable`, `EmptyState`, `Reveal`; gating read `useProjects().data?.projects.find(p => p.id === projectId)?.integrations?.revenuecat ?? false`.
- Produces: route `/projects/$projectId/subscriptions`; nav item `{ label: 'Subscriptions', to: p('/subscriptions'), icon: 'subscriptions' }` in the Explore group after Revenue; a shared helper `export function useRcEnabled(projectId?: string): boolean` in `dashboard/src/features/revenuecat/api.ts` (reused by Tasks 19–22).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import { TEST_PROJECT, VALID_ACCESS_TOKEN, TEST_USER, projectsHandlerWithoutRc } from '../../../test/msw/handlers';
import { authStore } from '../../../lib/auth/store';

const URL = `/projects/${TEST_PROJECT.id}/subscriptions`;

describe('SubscriptionsPage', () => {
  it('renders KPI tiles, trend, churn donut, and breakdown tables from the summary', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('MRR')).toBeInTheDocument();
    expect(main.getByText('$49.95')).toBeInTheDocument();       // 4995 cents from the fixture
    expect(main.getByText('Active subscribers')).toBeInTheDocument();
    expect(main.getByText(/churn reasons/i)).toBeInTheDocument();
    expect(main.getByText(/by product/i)).toBeInTheDocument();
  });

  it('shows the Subscriptions nav entry when RC is connected', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    const nav = within(await screen.findByRole('navigation'));
    expect(await nav.findByText('Subscriptions')).toBeInTheDocument();
  });

  it('hides the nav entry and shows an empty state when RC is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText(/connect revenuecat/i)).toBeInTheDocument();
    const nav = within(screen.getByRole('navigation'));
    await waitFor(() => expect(nav.queryByText('Subscriptions')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && npx vitest run src/features/analytics/components/subscriptions.test.tsx`
Expected: FAIL — route not found / page missing.

- [ ] **Step 3: Implement**

1. `useRcEnabled` in `features/revenuecat/api.ts`:

```ts
export function useRcEnabled(projectId?: string): boolean {
  const { data } = useProjects();
  if (!projectId) return false;
  return data?.projects.find((p) => p.id === projectId)?.integrations?.revenuecat ?? false;
}
```

2. `SubscriptionsPage.tsx` — mirror `RevenuePage.tsx`'s structure exactly (same `chartState` helper, `PageShell` + `DateRangeControl`, `Reveal` indices): gating guard first (`if (!rcEnabled) return <PageShell …><EmptyState title="Connect RevenueCat" description="Connect RevenueCat in project settings to see subscription analytics." /></PageShell>`); then `SectionGrid` KPI row — `KpiTile label="MRR" value={formatCurrency(data.mrr_cents / 100)} unfiltered`, `Active subscribers` (`unfiltered`), `In trial` (`unfiltered`), `New subscriptions`, `Churned`, `Trial→paid` (`trials_converted / trials_started`, zero-guarded, as %); `ChartCard "New subscriptions"` with `ComparisonTrend` over `by_day` (xKey `t`, valueKey `new_subscriptions`); `ChartCard "Churn reasons"` with `DonutChart`; `DataTable`s for `by_product` (render `mrr_cents` as currency), `by_store`, `recent_events` — each with `exportFilename`.
3. Router: import + `const subscriptionsRoute = createRoute({ getParentRoute: () => privateRoute, path: '/projects/$projectId/subscriptions', component: SubscriptionsPage })` + add to `addChildren`.
4. `nav-model.ts`: add the item to the Explore group after Revenue. `NavIcon.tsx`: add a `subscriptions` case to `IconName` + SVG (a simple "repeat/cycle" arrows path is fine — copy an existing icon's SVG scaffold).
5. AppLayout + CommandPalette: both currently consume `projectGroups()` raw; filter it through the flag —

```ts
const rcEnabled = useRcEnabled(projectId);
const groups = useMemo(
  () => projectGroups().map((g) => ({
    ...g,
    items: g.items.filter((i) => rcEnabled || !i.to.endsWith('/subscriptions')),
  })),
  [rcEnabled],
);
```

- [ ] **Step 4: Run the page test + full dashboard suite (nav-model is consumed everywhere)**

Run: `cd dashboard && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src
git commit -m "feat(dashboard): gated subscriptions page with nav + command palette entries"
```

---

### Task 19: Attribution sections on the Subscriptions page

**Files:**
- Modify: `dashboard/src/features/analytics/components/SubscriptionsPage.tsx`
- Test: extend `subscriptions.test.tsx`

**Interfaces:**
- Consumes: `useSubscriptionAttribution` (Task 16); `DataTable`, `BreakdownChart`, `KpiTile`, `ChartCard`.
- Produces: three new sections — "Conversion drivers" (drivers + screens `DataTable`s), "Time to convert" (`BreakdownChart` over the fixed bucket order), "Trial funnel" (`KpiTile`s: Trials, Converted, Conversion rate).

- [ ] **Step 1: Add failing assertions to `subscriptions.test.tsx`**

```tsx
it('renders attribution: drivers, time-to-convert, trial funnel', async () => {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
  renderApp(URL);
  const main = within(await screen.findByRole('main'));
  expect(await main.findByText(/conversion drivers/i)).toBeInTheDocument();
  expect(main.getByText(/time to convert/i)).toBeInTheDocument();
  expect(main.getByText(/trial funnel/i)).toBeInTheDocument();
  // from SUBSCRIPTION_ATTRIBUTION_FIXTURE:
  expect(main.getByText('$screen_view')).toBeInTheDocument();
  expect(main.getByText('Paywall')).toBeInTheDocument();
});
```

(Ensure `SUBSCRIPTION_ATTRIBUTION_FIXTURE` in Task 16 contains a `$screen_view` driver row and a `Paywall` screen row.)

- [ ] **Step 2: Run to verify failure, implement, re-run**

Run: `cd dashboard && npx vitest run src/features/analytics/components/subscriptions.test.tsx` → FAIL → implement the three sections (each in a `Reveal`, each `ChartCard`/`DataTable` fed from `useSubscriptionAttribution(projectId, from, to)`, bucket order constant `['<1d','1-3d','3-7d','7-14d','14-30d','30d+']`, conversion rate zero-guarded) → re-run → PASS.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/features/analytics
git commit -m "feat(dashboard): conversion drivers, time-to-convert and trial funnel sections"
```

---

### Task 20: User profile subscription card + timeline treatment

**Files:**
- Modify: `dashboard/src/features/analytics/components/UserProfileModal.tsx`
- Test: extend the modal's existing test file (locate: `grep -rln "UserProfileModal\|user-profile" dashboard/src/features/analytics/components/*.test.tsx`)

**Interfaces:**
- Consumes: `useUserSubscription(projectId, distinctId, enabled: rcEnabled)`, `useRefreshUserSubscription` (Task 16); `useRcEnabled` (Task 18); `Card`, `Badge`, `Button`, `CollapsibleSection`.
- Produces:
  - LEFT column (after Device properties): `CollapsibleSection title="Subscription" defaultOpen` containing status `Badge` (variant map: active→success, trial→info, grace→warning, paused→outline, churned→danger), plan/store/period rows, total spent + MRR (currency), first purchased / renews-expires dates, "Refresh from RevenueCat" `Button` (analyst+ — reuse the modal's existing role source if it has one; otherwise show and let the 403 toast), "Open in RevenueCat" anchor when `rc_customer_url` is set. Hidden entirely when `!rcEnabled` or `subscription === null`.
  - Timeline: `$rc_*` events get an accent dot + `Badge variant="accent">subscription</Badge>`; the OLDEST `$rc_initial_purchase` in `recent_events` additionally renders a `"★ First subscribed"` divider row above it.

- [ ] **Step 1: Write failing tests (in the modal's existing test file, reusing its fixtures/open-modal helper)**

```tsx
it('shows the subscription card with status badge and RC link', async () => {
  // open the modal the way existing tests do…
  expect(await screen.findByText('Subscription')).toBeInTheDocument();
  expect(screen.getByText('active')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /open in revenuecat/i }))
    .toHaveAttribute('href', USER_SUBSCRIPTION_FIXTURE.subscription!.rc_customer_url);
});

it('marks $rc_ timeline events and renders the first-subscribed divider', async () => {
  // fixture recent_events must include one $rc_initial_purchase and one $rc_renewal (Task 16)
  expect(await screen.findByText('★ First subscribed')).toBeInTheDocument();
  expect(screen.getAllByText('subscription').length).toBeGreaterThanOrEqual(2); // badges
});

it('renders no subscription card when RC is not connected', async () => {
  server.use(projectsHandlerWithoutRc());
  // …open modal…
  await waitFor(() => expect(screen.queryByText('Subscription')).not.toBeInTheDocument());
});
```

(Extend the `USER_PROFILE_FIXTURE`-equivalent's `recent_events` with `$rc_initial_purchase` + `$rc_renewal` rows in Task 16's handlers if not already done — keep timestamps newest-first like the endpoint returns.)

- [ ] **Step 2: Run to verify failure, implement, re-run**

Run: `cd dashboard && npx vitest run <modal test file>` → FAIL → implement (divider logic: `const firstSubIdx = [...recent_events].reverse().findIndex(e => e.event === '$rc_initial_purchase')` → map back to the forward index; render the divider `<li>` before that item) → re-run → PASS. Also run the full analytics component suite: `npx vitest run src/features/analytics`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/features/analytics dashboard/src/test
git commit -m "feat(dashboard): user profile subscription card + rc timeline treatment"
```

---

### Task 21: Subscription quick-filter chip + curated properties

**Files:**
- Modify: `dashboard/src/features/analytics/components/GlobalFilterBar.tsx`
- Test: extend the filter bar's existing test file

**Interfaces:**
- Consumes: `useGlobalFilters().toggleGlobalFilter`; `useRcEnabled`; `InsightsFilter.target` (Task 16).
- Produces: when RC is enabled, a "Subscription:" chip row with `Subscribers` / `Trial` / `Churned` toggle buttons, each toggling `{ property: '$rc_status', op: 'eq', value: 'active'|'trial'|'churned', target: 'profile' }`; the property combobox list gains a curated `$rc_status | $rc_product_id | $rc_store | $rc_total_spent` group (appended to the `useMetaProperties` names). Filters with `target:'profile'` display with a small "profile" badge on their chip. Nothing renders when RC is off.

- [ ] **Step 1: Write failing tests**

```tsx
it('renders subscription quick filters when RC is connected and toggles a profile-target filter', async () => {
  // render a page with the filter bar per the existing filter-bar tests…
  await userEvent.click(await screen.findByRole('button', { name: 'Subscribers' }));
  // assert via the chip row: the active filter chip shows the property and the profile badge
  expect(screen.getByText('$rc_status')).toBeInTheDocument();
  expect(screen.getByText('profile')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Subscribers' })); // toggle off
  await waitFor(() => expect(screen.queryByText('$rc_status')).not.toBeInTheDocument());
});

it('renders no subscription quick filters when RC is off', async () => {
  server.use(projectsHandlerWithoutRc());
  // …render…
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Subscribers' })).not.toBeInTheDocument());
});
```

- [ ] **Step 2: Run to verify failure, implement, re-run**

Run the filter-bar test file → FAIL → implement (quick-chip row above/beside the existing chips; `QUICK_FILTERS: Array<{ label: string; value: string }> = [{ label: 'Subscribers', value: 'active' }, { label: 'Trial', value: 'trial' }, { label: 'Churned', value: 'churned' }]`; active-state styling by checking `filters.some(f => f.property === '$rc_status' && f.value === value)`) → re-run + full `npx vitest run src/features/analytics` → PASS. Verify `encodeFiltersParam` JSON-encodes whole filter objects so `target` round-trips (it does if it's a plain JSON codec — confirm with its unit test; if it whitelists keys, add `target`).

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/features/analytics
git commit -m "feat(dashboard): subscription quick filters over profile-target properties"
```

---

### Task 22: Home KPI tiles + Live view styling

**Files:**
- Modify: `dashboard/src/features/analytics/components/HomePage.tsx`, `dashboard/src/features/analytics/components/LiveEventsPage.tsx`
- Test: extend `home.test.tsx` and the live page's test file

**Interfaces:**
- Consumes: `useSubscriptionsSummary`, `useRcEnabled`.
- Produces: Home — when RC enabled, two extra `KpiTile`s in the existing KPI `SectionGrid` (`MRR` and `Active subscribers`, both `unfiltered`, values from `useSubscriptionsSummary` over the current date range); Live — event rows where `event.event.startsWith('$rc_')` render a `Badge variant="accent">subscription</Badge>` next to the event name. Zero rendering change when RC is off.

- [ ] **Step 1: Write failing tests**

`home.test.tsx`:

```tsx
it('shows MRR and Active subscribers tiles when RC is connected', async () => {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
  renderApp(`/projects/${TEST_PROJECT.id}`); // home route — copy the URL existing home tests use
  const main = within(await screen.findByRole('main'));
  expect(await main.findByText('MRR')).toBeInTheDocument();
  expect(main.getByText('Active subscribers')).toBeInTheDocument();
});

it('shows no RC tiles when disconnected', async () => {
  server.use(projectsHandlerWithoutRc());
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
  renderApp(`/projects/${TEST_PROJECT.id}`);
  const main = within(await screen.findByRole('main'));
  await main.findByRole('heading'); // page settled
  await waitFor(() => expect(main.queryByText('MRR')).not.toBeInTheDocument());
});
```

Live test: add an `$rc_renewal` row to the live-events fixture and assert one `subscription` badge renders; assert zero with `projectsHandlerWithoutRc()`.

- [ ] **Step 2: Run to verify failure, implement, re-run**

→ FAIL → implement both (Home: `const rcEnabled = useRcEnabled(projectId); const subs = useSubscriptionsSummary(projectId, from, to, [],);` with `enabled` folded in via the hook's range guard — pass empty strings when `!rcEnabled` or add an `enabled` opt to the hook) → re-run: `cd dashboard && npm test` (full suite — final regression gate) → PASS.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/features/analytics
git commit -m "feat(dashboard): home subscription KPIs + live view rc badges"
```

---

# Final verification

- [ ] `cd backend && npm test && npm run typecheck && npm run build` — all green.
- [ ] `cd dashboard && npm test && npm run build` — all green.
- [ ] `cd sdk/flutter_analytics && flutter test` — all green.
- [ ] Gating audit (the Global Constraint): `grep -rn "revenuecat\|rc_\|\$rc" dashboard/src --include="*.tsx" -l` — every listed component must read `useRcEnabled`/`integrations.revenuecat` or live under `features/revenuecat/`; backend: confirm no existing endpoint changed behavior except the additive `integrations` field and the additive `target`/`profile` schema options.
- [ ] Run `graphify update .` to refresh the knowledge graph.
- [ ] End-to-end smoke (requires the Docker stack): connect a test integration via the UI, `curl -X POST localhost:<port>/webhooks/revenuecat/<projectId> -H "Authorization: <secret>" -d @sample-initial-purchase.json`, verify the event appears in Live view, the user's timeline, and the Subscriptions page.

## Notes for the executor

- **Import paths are the plan's best guesses in 4 spots** (flagged inline): `JwtAuthGuard`/`AuthRequest`, `parseOrThrow`, `authStore` test helper, and the modal test filename. Resolve each by copying from the named reference file before writing code.
- **Spec deviations locked here:** journal rows use `skipped` for sandbox drops (spec's §4.2 "drop" made observable); statuses have no `expired` (EXPIRATION → `churned`); unlinked auto-replay triggers on the next successful webhook for the same app_user_id, manual Replay, or re-sync — not on `$rc_link` ingestion itself (the SDK ingest path has no RC hook, by design).
- **Do not touch** `infra/clickhouse/init.sql` — no schema change is needed (events + user_profiles absorb everything), and its `;`-splitting loader is fragile.



