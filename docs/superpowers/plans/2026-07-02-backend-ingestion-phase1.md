# Backend Ingestion (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A production-shaped NestJS 11 ingestion backend in `backend/` plus the shared `packages/contracts` package: Zod-validated config, Prisma metadata schema (contracts §6) with first migration, ClickHouse async-insert writer, Redis-cached SDK-token auth, distributed sliding-window rate limiting, and `POST /ingest/events` / `POST /ingest/profiles` implementing shared-contracts §4 exactly — RFC 7807 errors, pino logging, health endpoints, graceful SIGTERM shutdown, tested at unit/integration/e2e levels.

**Architecture:** Stateless Cloud Run-ready API: no in-process buffering (ClickHouse `async_insert=1, wait_for_async_insert=1` batches server-side; `insert_id` in the ReplacingMergeTree key makes retries idempotent), all shared state in Redis (token cache, rate-limit windows) and the databases. A single global RFC 7807 filter and a gzip-aware JSON body-parser middleware wrap two guarded ingest endpoints that validate per-item and never fail a batch wholesale.

**Tech Stack:** Node 22, pnpm 10, NestJS 11 (Express platform), TypeScript 5.8+, Zod 3, Prisma 6 (PostgreSQL 17), `@clickhouse/client` 1.x (ClickHouse 24.8), ioredis 5 (Redis 7), nestjs-pino/pino 9, Jest 29 + ts-jest, Testcontainers, supertest.

## Global Constraints

Copied from `docs/superpowers/specs/2026-07-02-shared-contracts.md` — these are non-negotiable:

- **Node 22** (pinned in `package.json engines`), **pnpm 10** workspace (root `pnpm-workspace.yaml` lists `backend`, `dashboard`, `packages/*` — already exists, do not touch).
- **NestJS 11**, **TypeScript 5.8+**.
- Backend listens on **port 8080** (`PORT=8080` default).
- Env vars exactly per contracts §3; Zod-validated at boot; missing/invalid vars crash the boot with a clear message; `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` min 32 chars, required outside `NODE_ENV=test`. `INGEST_MAX_BATCH=100`, `INGEST_MAX_BODY_KB=1024` defaults.
- Ingest auth: `Authorization: Bearer mam_<32 hex>`; rate limit **1000 req/min per token** (Redis sliding window) → 429.
- ClickHouse DDL per contracts §5 verbatim; inserts use `async_insert=1, wait_for_async_insert=1`. Exact counts use `count(DISTINCT insert_id)`.
- Timestamp clamping to `[now−7d, now+5min]`; server sets authoritative `server_timestamp`.
- Error shape everywhere: **RFC 7807** `{type, title, status, detail?, errors?}` with `Content-Type: application/problem+json`.
- Coverage floor: **85% lines** (backend), CI-enforced.
- **Conventional Commits** (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`).
- Local infra images (used by Testcontainers too): `clickhouse/clickhouse-server:24.8`, `postgres:17-alpine`, `redis:7-alpine`.

**Prerequisites (assumed, do NOT create):** root `pnpm-workspace.yaml` + root ESLint/Prettier config, `infra/docker-compose.yml` (contracts §2), `infra/clickhouse/init.sql` containing contracts §5 DDL, `.nvmrc` = 22. Docker must be running for integration/e2e tasks. Run `pnpm install` at the repo root after any `package.json` is created.

**Conventions for this plan:** all paths relative to repo root `myampmix/`. Every task ends with a commit. Run unit tests with `pnpm --filter @myampmix/backend test`, integration with `... test:int`, e2e with `... test:e2e`.

---

### Task 1: `@myampmix/contracts` — ingest payload schemas and types

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/tsconfig.build.json`
- Create: `packages/contracts/jest.config.js`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/ingest.ts`
- Test: `packages/contracts/test/ingest.spec.ts`

**Interfaces:**
- Produces: `ingestEventSchema` (Zod object schema for one ingest event, contracts §4), `eventContextSchema`, `ingestEventsRequestSchema` (envelope `{events: unknown[]}`), `profileOperationSchema`, `ingestProfilesRequestSchema` (envelope `{operations: unknown[]}`)
- Produces types: `IngestEvent`, `EventContext`, `ProfileOperation`, `ProfileOp`, `RejectedItem { index: number; reason: string }`, `IngestResponse { accepted: number; rejected: RejectedItem[] }`
- Produces: `SDK_TOKEN_REGEX: RegExp` (`/^mam_[0-9a-f]{32}$/`), `RESERVED_EVENTS: readonly string[]`, `RESERVED_PROPERTY_PREFIX = '$'`
- Consumes: nothing (leaf package; only dependency is `zod`).

**Steps:**

- [ ] Create the package skeleton.

`packages/contracts/package.json`:

```json
{
  "name": "@myampmix/contracts",
  "version": "0.1.0",
  "private": true,
  "description": "Shared Zod schemas and TypeScript types for MyAmpMix (ingest payloads, query definitions, API DTOs)",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "jest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.14",
    "jest": "^29.7.0",
    "ts-jest": "^29.3.0",
    "typescript": "^5.8.3"
  },
  "engines": {
    "node": "22"
  }
}
```

`packages/contracts/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": true,
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "test"]
}
```

`packages/contracts/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "include": ["src"],
  "exclude": ["test", "**/*.spec.ts"]
}
```

`packages/contracts/jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
};
```

- [ ] Run `pnpm install` at the repo root (links the new workspace package).
- [ ] Write the failing test `packages/contracts/test/ingest.spec.ts` (COMPLETE file):

```ts
import {
  eventContextSchema,
  ingestEventSchema,
  ingestEventsRequestSchema,
  ingestProfilesRequestSchema,
  profileOperationSchema,
  RESERVED_EVENTS,
  SDK_TOKEN_REGEX,
} from '../src';

const validEvent = {
  insert_id: '018f6b2e-7c1a-7f3b-9c4d-1a2b3c4d5e6f',
  event: 'checkout_completed',
  distinct_id: 'u_42',
  anon_id: '018f6b2e-aaaa-7f3b-9c4d-1a2b3c4d5e6f',
  session_id: '018f6b2e-bbbb-7f3b-9c4d-1a2b3c4d5e6f',
  timestamp: 1751462400123,
  properties: { plan: 'pro', value: 9.99 },
  context: {
    app_version: '1.4.2',
    app_build: '142',
    os: 'ios',
    os_version: '18.5',
    device_model: 'iPhone16,2',
    device_manufacturer: 'Apple',
    locale: 'fr_FR',
    timezone: 'Europe/Paris',
    screen_width: 393,
    screen_height: 852,
    network: 'wifi',
    sdk_version: '0.1.0',
    utm_source: 'tiktok',
    utm_medium: 'paid',
    utm_campaign: 'summer',
    utm_content: null,
    utm_term: null,
    first_utm_source: 'meta',
    first_utm_campaign: 'launch',
    install_referrer: 'utm_source=facebook&utm_campaign=x',
  },
};

describe('ingestEventSchema', () => {
  it('accepts the shared-contracts §4 example event', () => {
    expect(ingestEventSchema.safeParse(validEvent).success).toBe(true);
  });

  it('accepts a minimal event without properties/context', () => {
    const { properties, context, ...minimal } = validEvent;
    expect(ingestEventSchema.safeParse(minimal).success).toBe(true);
  });

  it('rejects a missing insert_id', () => {
    const { insert_id, ...bad } = validEvent;
    const result = ingestEventSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['insert_id']);
    }
  });

  it('rejects a non-UUID insert_id', () => {
    expect(ingestEventSchema.safeParse({ ...validEvent, insert_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an event name longer than 255 chars', () => {
    expect(ingestEventSchema.safeParse({ ...validEvent, event: 'x'.repeat(256) }).success).toBe(false);
  });

  it('rejects an empty event name', () => {
    expect(ingestEventSchema.safeParse({ ...validEvent, event: '' }).success).toBe(false);
  });

  it('rejects a non-integer timestamp', () => {
    expect(ingestEventSchema.safeParse({ ...validEvent, timestamp: 'now' }).success).toBe(false);
  });

  it('accepts null UTM fields in context', () => {
    expect(eventContextSchema.safeParse({ utm_content: null, utm_term: null }).success).toBe(true);
  });
});

describe('profileOperationSchema', () => {
  const validOp = {
    distinct_id: 'u_42',
    op: 'set',
    properties: { plan: 'pro' },
    timestamp: 1751462400123,
  };

  it.each(['set', 'set_once', 'increment', 'append', 'unset', 'delete'])('accepts op %s', (op) => {
    expect(profileOperationSchema.safeParse({ ...validOp, op }).success).toBe(true);
  });

  it('rejects an unknown op', () => {
    expect(profileOperationSchema.safeParse({ ...validOp, op: 'merge' }).success).toBe(false);
  });

  it('rejects a missing distinct_id', () => {
    const { distinct_id, ...bad } = validOp;
    expect(profileOperationSchema.safeParse(bad).success).toBe(false);
  });
});

describe('request envelopes', () => {
  it('requires a non-empty events array', () => {
    expect(ingestEventsRequestSchema.safeParse({ events: [] }).success).toBe(false);
    expect(ingestEventsRequestSchema.safeParse({}).success).toBe(false);
    expect(ingestEventsRequestSchema.safeParse({ events: [{}] }).success).toBe(true);
  });

  it('requires a non-empty operations array', () => {
    expect(ingestProfilesRequestSchema.safeParse({ operations: [] }).success).toBe(false);
    expect(ingestProfilesRequestSchema.safeParse({ operations: [{}] }).success).toBe(true);
  });
});

describe('SDK_TOKEN_REGEX', () => {
  it('matches mam_ + 32 hex chars', () => {
    expect(SDK_TOKEN_REGEX.test('mam_' + 'a1b2c3d4'.repeat(4))).toBe(true);
  });

  it.each(['mam_short', 'MAM_' + 'a'.repeat(32), 'mam_' + 'g'.repeat(32), 'a'.repeat(36)])(
    'rejects %s',
    (token) => {
      expect(SDK_TOKEN_REGEX.test(token)).toBe(false);
    },
  );
});

describe('reserved names', () => {
  it('exports the shared-contracts §4 reserved event list', () => {
    expect(RESERVED_EVENTS).toEqual(
      expect.arrayContaining(['$first_open', '$session_start', '$session_end', '$screen_view', '$tap']),
    );
  });
});
```

- [ ] Run `pnpm --filter @myampmix/contracts test` — expected **FAIL**: `Cannot find module '../src'` (nothing implemented yet).
- [ ] Implement `packages/contracts/src/ingest.ts` (COMPLETE file):

```ts
import { z } from 'zod';

/** Ingest SDK token format: `mam_` + 32 hex chars (shared contracts §4). */
export const SDK_TOKEN_REGEX = /^mam_[0-9a-f]{32}$/;

/** Reserved event names emitted by SDK autocapture (shared contracts §4). */
export const RESERVED_EVENTS = [
  '$first_open',
  '$app_open',
  '$app_background',
  '$session_start',
  '$session_end',
  '$screen_view',
  '$tap',
  '$rage_tap',
  '$identify',
  '$campaign_touch',
] as const;

/** Reserved property prefix (shared contracts §4). */
export const RESERVED_PROPERTY_PREFIX = '$';

/** Optional device/app context attached to every event (shared contracts §4). */
export const eventContextSchema = z
  .object({
    app_version: z.string().max(64),
    app_build: z.string().max(64),
    os: z.string().max(32),
    os_version: z.string().max(32),
    device_model: z.string().max(128),
    device_manufacturer: z.string().max(64),
    locale: z.string().max(32),
    timezone: z.string().max(64),
    screen_width: z.number().int().min(0).max(65535),
    screen_height: z.number().int().min(0).max(65535),
    network: z.string().max(32),
    sdk_version: z.string().max(32),
    utm_source: z.string().max(255).nullable(),
    utm_medium: z.string().max(255).nullable(),
    utm_campaign: z.string().max(1024).nullable(),
    utm_content: z.string().max(1024).nullable(),
    utm_term: z.string().max(1024).nullable(),
    first_utm_source: z.string().max(255).nullable(),
    first_utm_campaign: z.string().max(1024).nullable(),
    install_referrer: z.string().max(4096).nullable(),
  })
  .partial();

/** One event as sent by the SDK to POST /ingest/events (shared contracts §4). */
export const ingestEventSchema = z.object({
  insert_id: z.string().uuid(),
  event: z.string().min(1).max(255),
  distinct_id: z.string().min(1).max(255),
  anon_id: z.string().min(1).max(255),
  session_id: z.string().uuid(),
  timestamp: z.number().int().positive(),
  properties: z.record(z.string(), z.unknown()).optional(),
  context: eventContextSchema.optional(),
});

/**
 * Request envelope for POST /ingest/events. Items are `unknown` on purpose:
 * validation is per-item (accept/reject), never all-or-nothing.
 */
export const ingestEventsRequestSchema = z.object({
  events: z.array(z.unknown()).min(1),
});

export const profileOpSchema = z.enum(['set', 'set_once', 'increment', 'append', 'unset', 'delete']);

/** One profile operation for POST /ingest/profiles (shared contracts §4). */
export const profileOperationSchema = z.object({
  distinct_id: z.string().min(1).max(255),
  op: profileOpSchema,
  properties: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.number().int().positive(),
});

/** Request envelope for POST /ingest/profiles. Per-item validation, like events. */
export const ingestProfilesRequestSchema = z.object({
  operations: z.array(z.unknown()).min(1),
});

export type EventContext = z.infer<typeof eventContextSchema>;
export type IngestEvent = z.infer<typeof ingestEventSchema>;
export type ProfileOp = z.infer<typeof profileOpSchema>;
export type ProfileOperation = z.infer<typeof profileOperationSchema>;

/** One rejected batch item in a 202 response (shared contracts §4). */
export interface RejectedItem {
  index: number;
  reason: string;
}

/** 202 response body for both ingest endpoints (shared contracts §4). */
export interface IngestResponse {
  accepted: number;
  rejected: RejectedItem[];
}
```

`packages/contracts/src/index.ts`:

```ts
export * from './ingest';
```

- [ ] Run `pnpm --filter @myampmix/contracts test` — expected **PASS**: `Tests: 18 passed`.
- [ ] Run `pnpm --filter @myampmix/contracts build` — expected: `dist/` emitted with `.d.ts` files, no errors.
- [ ] Commit:

```bash
git add packages/contracts
git commit -m "feat(contracts): zod schemas and types for ingest event/profile payloads"
```

---

### Task 2: Backend scaffold + Zod-validated config loader

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/tsconfig.build.json`
- Create: `backend/nest-cli.json`
- Create: `backend/jest.config.js`
- Create: `backend/.env.example`
- Create: `backend/src/config/app-config.ts`
- Create: `backend/src/config/config.module.ts`
- Create: `backend/src/app.module.ts`
- Create: `backend/src/main.ts`
- Test: `backend/src/config/app-config.spec.ts`

**Interfaces:**
- Produces: `APP_CONFIG = 'APP_CONFIG'` (Nest injection token), `interface AppConfig { nodeEnv: 'development' | 'test' | 'production'; port: number; databaseUrl: string; clickhouse: { url: string; user: string; password: string; database: string }; redisUrl: string; jwtAccessSecret: string | undefined; jwtRefreshSecret: string | undefined; ingestMaxBatch: number; ingestMaxBodyKb: number; ingestRateLimitPerMin: number }`, `loadConfig(env?: NodeJS.ProcessEnv): AppConfig` (throws on invalid), `AppConfigModule` (global)
- Produces: `createApp(): Promise<INestApplication>` in `backend/src/main.ts` (reused verbatim by e2e tests so tests exercise production wiring)
- Consumes: nothing yet.

**Steps:**

- [ ] Create `backend/package.json` (COMPLETE file — the full phase-1 dependency set is declared once, up front, to avoid churn in later tasks):

```json
{
  "name": "@myampmix/backend",
  "version": "0.1.0",
  "private": true,
  "description": "MyAmpMix NestJS backend — ingestion, analytics queries, auth",
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "test:cov": "jest --coverage",
    "test:int": "jest --config test/jest-integration.config.js --runInBand",
    "test:e2e": "jest --config test/jest-e2e.config.js --runInBand",
    "prisma": "prisma"
  },
  "dependencies": {
    "@clickhouse/client": "^1.11.0",
    "@myampmix/contracts": "workspace:*",
    "@nestjs/common": "^11.1.0",
    "@nestjs/core": "^11.1.0",
    "@nestjs/platform-express": "^11.1.0",
    "@prisma/client": "^6.8.0",
    "ioredis": "^5.6.0",
    "nestjs-pino": "^4.4.0",
    "pino": "^9.6.0",
    "pino-http": "^10.4.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.1.0",
    "@testcontainers/postgresql": "^10.24.0",
    "@types/express": "^5.0.1",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.15.0",
    "@types/supertest": "^6.0.3",
    "jest": "^29.7.0",
    "pino-pretty": "^13.0.0",
    "prisma": "^6.8.0",
    "supertest": "^7.1.0",
    "testcontainers": "^10.24.0",
    "ts-jest": "^29.3.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.8.3"
  },
  "engines": {
    "node": "22"
  }
}
```

- [ ] Create `backend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2023",
    "lib": ["ES2023"],
    "moduleResolution": "node",
    "declaration": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "test"]
}
```

- [ ] Create `backend/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "include": ["src"],
  "exclude": ["node_modules", "test", "dist", "**/*.spec.ts"]
}
```

- [ ] Create `backend/nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "tsConfigPath": "tsconfig.build.json"
  }
}
```

- [ ] Create `backend/jest.config.js` (unit suite; coverage floor 85% lines per contracts §9; bootstrap/wiring files are exercised by e2e, not unit-covered):

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleNameMapper: {
    '^@myampmix/contracts$': '<rootDir>/../packages/contracts/src',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts', '!src/**/*.spec.ts'],
  coverageThreshold: { global: { lines: 85 } },
};
```

- [ ] Create `backend/.env.example` (contracts §3, local-dev values from contracts §2):

```
NODE_ENV=development
PORT=8080
DATABASE_URL=postgresql://myampmix:myampmix_dev@localhost:5432/myampmix
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=myampmix_dev
CLICKHOUSE_DB=analytics
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=dev_only_change_me_dev_only_change_me
JWT_REFRESH_SECRET=dev_only_change_me_dev_only_change_yes
INGEST_MAX_BATCH=100
INGEST_MAX_BODY_KB=1024
```

- [ ] Run `pnpm install` at the repo root.
- [ ] Write the failing test `backend/src/config/app-config.spec.ts` (COMPLETE file):

```ts
import { loadConfig } from './app-config';

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://myampmix:myampmix_dev@localhost:5432/myampmix',
  CLICKHOUSE_URL: 'http://localhost:8123',
  CLICKHOUSE_USER: 'default',
  CLICKHOUSE_PASSWORD: 'myampmix_dev',
  CLICKHOUSE_DB: 'analytics',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('loadConfig', () => {
  it('parses a valid environment and applies contract defaults', () => {
    const config = loadConfig(validEnv);
    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(8080);
    expect(config.ingestMaxBatch).toBe(100);
    expect(config.ingestMaxBodyKb).toBe(1024);
    expect(config.ingestRateLimitPerMin).toBe(1000);
    expect(config.databaseUrl).toBe(validEnv.DATABASE_URL);
    expect(config.redisUrl).toBe('redis://localhost:6379');
    expect(config.clickhouse).toEqual({
      url: 'http://localhost:8123',
      user: 'default',
      password: 'myampmix_dev',
      database: 'analytics',
    });
  });

  it('coerces numeric env vars from strings', () => {
    const config = loadConfig({ ...validEnv, PORT: '9090', INGEST_MAX_BATCH: '50' });
    expect(config.port).toBe(9090);
    expect(config.ingestMaxBatch).toBe(50);
  });

  it('crashes with a clear message naming the missing var', () => {
    const { DATABASE_URL, ...withoutDb } = validEnv;
    expect(() => loadConfig(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'mysql://nope' })).toThrow(/DATABASE_URL/);
  });

  it('requires JWT secrets outside NODE_ENV=test', () => {
    const { JWT_ACCESS_SECRET, ...withoutJwt } = validEnv;
    expect(() => loadConfig(withoutJwt)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('allows missing JWT secrets when NODE_ENV=test', () => {
    const { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ...rest } = validEnv;
    expect(() => loadConfig({ ...rest, NODE_ENV: 'test' })).not.toThrow();
  });

  it('rejects JWT secrets shorter than 32 chars', () => {
    expect(() => loadConfig({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **FAIL**: `Cannot find module './app-config'`.
- [ ] Implement `backend/src/config/app-config.ts` (COMPLETE file):

```ts
import { z } from 'zod';

export const APP_CONFIG = 'APP_CONFIG';

/** Environment schema per shared contracts §3. Unknown keys in process.env are ignored. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().regex(/^postgresql:\/\//, 'must be a postgresql:// URL'),
  CLICKHOUSE_URL: z.string().url(),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string(),
  CLICKHOUSE_DB: z.string().min(1),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL'),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  INGEST_MAX_BATCH: z.coerce.number().int().positive().default(100),
  INGEST_MAX_BODY_KB: z.coerce.number().int().positive().default(1024),
  // Contracts §4 fixes this at 1000; the env override exists only so tests can exercise 429s cheaply.
  INGEST_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(1000),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  clickhouse: { url: string; user: string; password: string; database: string };
  redisUrl: string;
  jwtAccessSecret: string | undefined;
  jwtRefreshSecret: string | undefined;
  ingestMaxBatch: number;
  ingestMaxBodyKb: number;
  ingestRateLimitPerMin: number;
}

/** Parses and validates the environment. Throws (crashing boot) on any invalid/missing var. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const v = parsed.data;
  if (v.NODE_ENV !== 'test' && (!v.JWT_ACCESS_SECRET || !v.JWT_REFRESH_SECRET)) {
    throw new Error(
      'Invalid environment configuration:\n  JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (min 32 chars) are required outside NODE_ENV=test',
    );
  }
  return {
    nodeEnv: v.NODE_ENV,
    port: v.PORT,
    databaseUrl: v.DATABASE_URL,
    clickhouse: {
      url: v.CLICKHOUSE_URL,
      user: v.CLICKHOUSE_USER,
      password: v.CLICKHOUSE_PASSWORD,
      database: v.CLICKHOUSE_DB,
    },
    redisUrl: v.REDIS_URL,
    jwtAccessSecret: v.JWT_ACCESS_SECRET,
    jwtRefreshSecret: v.JWT_REFRESH_SECRET,
    ingestMaxBatch: v.INGEST_MAX_BATCH,
    ingestMaxBodyKb: v.INGEST_MAX_BODY_KB,
    ingestRateLimitPerMin: v.INGEST_RATE_LIMIT_PER_MIN,
  };
}
```

- [ ] Implement `backend/src/config/config.module.ts` (COMPLETE file):

```ts
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './app-config';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
```

- [ ] Implement `backend/src/app.module.ts` (COMPLETE file — extended in later tasks):

```ts
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';

@Module({
  imports: [AppConfigModule],
})
export class AppModule {}
```

- [ ] Implement `backend/src/main.ts` (COMPLETE file — extended in Task 3):

```ts
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/app-config';

/** Builds the fully wired application. Reused by e2e tests so they exercise production wiring. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port, '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **PASS**: `Tests: 7 passed`.
- [ ] Verify the boot-crash behavior: `pnpm --filter @myampmix/contracts build && pnpm --filter @myampmix/backend build && cd backend && NODE_ENV=production node dist/main.js; cd ..` — expected: process exits non-zero printing `Invalid environment configuration:` naming the missing vars.
- [ ] Commit:

```bash
git add backend
git commit -m "feat(backend): nestjs 11 scaffold with zod-validated config loader"
```

---

### Task 3: RFC 7807 problem details, gzip-aware JSON body parsing, pino logging

**Files:**
- Create: `backend/src/common/problem-details.ts`
- Create: `backend/src/common/problem-details.filter.ts`
- Create: `backend/src/common/json-body.middleware.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/main.ts`
- Test: `backend/src/common/problem-details.filter.spec.ts`
- Test: `backend/src/common/json-body.middleware.spec.ts`

**Interfaces:**
- Produces: `interface ProblemDetails { type: string; title: string; status: number; detail?: string; errors?: unknown; instance?: string }`, `class ProblemException extends HttpException` with `constructor(init: { status: number; title: string; detail?: string; type?: string; errors?: unknown; retryAfterSeconds?: number })` and readonly `problem: ProblemDetails`, `retryAfterSeconds?: number`
- Produces: `class ProblemDetailsFilter implements ExceptionFilter` (global filter), `jsonBodyParser(maxBodyKb: number): RequestHandler` (gzip via body-parser `inflate`), `problemFromBodyParserError(err: unknown): ProblemDetails`
- Consumes: `AppConfig` (Task 2) for the body limit.

**Steps:**

- [ ] Write the failing test `backend/src/common/problem-details.filter.spec.ts` (COMPLETE file):

```ts
import { ArgumentsHost, HttpException, NotFoundException } from '@nestjs/common';
import { ProblemException } from './problem-details';
import { ProblemDetailsFilter } from './problem-details.filter';

interface MockResponse {
  statusCode: number;
  contentType?: string;
  headers: Record<string, string>;
  body?: unknown;
  status(code: number): MockResponse;
  type(t: string): MockResponse;
  setHeader(name: string, value: string): void;
  send(body: unknown): MockResponse;
}

function mockHost(url = '/ingest/events'): { host: ArgumentsHost; res: MockResponse } {
  const res: MockResponse = {
    statusCode: 0,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    type(t) {
      this.contentType = t;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ originalUrl: url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();

  it('serializes a ProblemException as application/problem+json', () => {
    const { host, res } = mockHost();
    filter.catch(new ProblemException({ status: 401, title: 'Unauthorized', detail: 'bad token' }), host);
    expect(res.statusCode).toBe(401);
    expect(res.contentType).toBe('application/problem+json');
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      detail: 'bad token',
      instance: '/ingest/events',
    });
  });

  it('sets Retry-After for problems carrying retryAfterSeconds', () => {
    const { host, res } = mockHost();
    filter.catch(
      new ProblemException({ status: 429, title: 'Too Many Requests', retryAfterSeconds: 12 }),
      host,
    );
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('12');
  });

  it('converts a plain HttpException', () => {
    const { host, res } = mockHost('/nope');
    filter.catch(new NotFoundException('Cannot GET /nope'), host);
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ status: 404, title: 'Not Found', detail: 'Cannot GET /nope' });
  });

  it('converts an HttpException with an object body', () => {
    const { host, res } = mockHost();
    filter.catch(new HttpException({ message: 'boom' }, 400), host);
    expect(res.body).toMatchObject({ status: 400, title: 'Bad Request', detail: 'boom' });
  });

  it('masks unknown errors as a 500 problem without leaking internals', () => {
    const { host, res } = mockHost();
    filter.catch(new Error('secret stack detail'), host);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      instance: '/ingest/events',
    });
  });
});
```

- [ ] Write the failing test `backend/src/common/json-body.middleware.spec.ts` (COMPLETE file):

```ts
import { problemFromBodyParserError } from './json-body.middleware';

describe('problemFromBodyParserError', () => {
  it('maps entity.too.large to a 413 problem', () => {
    expect(problemFromBodyParserError({ type: 'entity.too.large', status: 413 })).toEqual({
      type: 'about:blank',
      title: 'Payload Too Large',
      status: 413,
      detail: 'Request body exceeds INGEST_MAX_BODY_KB',
    });
  });

  it('maps entity.parse.failed to a 400 problem', () => {
    expect(problemFromBodyParserError({ type: 'entity.parse.failed', status: 400 })).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Malformed JSON body',
    });
  });

  it('maps encoding.unsupported to a 415 problem', () => {
    expect(problemFromBodyParserError({ type: 'encoding.unsupported', status: 415 })).toMatchObject({
      status: 415,
      title: 'Unsupported Media Type',
    });
  });

  it('falls back to a 400 problem for unknown parser errors', () => {
    expect(problemFromBodyParserError(new Error('weird'))).toMatchObject({ status: 400, title: 'Bad Request' });
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **FAIL**: `Cannot find module './problem-details'` / `'./json-body.middleware'`.
- [ ] Implement `backend/src/common/problem-details.ts` (COMPLETE file):

```ts
import { HttpException } from '@nestjs/common';

/** RFC 7807 problem-details body (shared contracts §7 error shape). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: unknown;
  instance?: string;
}

export interface ProblemInit {
  status: number;
  title: string;
  detail?: string;
  type?: string;
  errors?: unknown;
  /** When set, the global filter adds a Retry-After response header (used for 429). */
  retryAfterSeconds?: number;
}

/** Throw this anywhere; the global ProblemDetailsFilter serializes it verbatim. */
export class ProblemException extends HttpException {
  readonly problem: ProblemDetails;
  readonly retryAfterSeconds?: number;

  constructor(init: ProblemInit) {
    const problem: ProblemDetails = {
      type: init.type ?? 'about:blank',
      title: init.title,
      status: init.status,
      ...(init.detail !== undefined && { detail: init.detail }),
      ...(init.errors !== undefined && { errors: init.errors }),
    };
    super(problem, init.status);
    this.problem = problem;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

export const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};
```

- [ ] Implement `backend/src/common/problem-details.filter.ts` (COMPLETE file):

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProblemDetails, ProblemException, STATUS_TITLES } from './problem-details';

/** Global exception filter: every error leaves the API as RFC 7807 application/problem+json. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const problem = this.toProblem(exception);
    problem.instance = req.originalUrl;

    if (exception instanceof ProblemException && exception.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }
    if (problem.status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }

    res.status(problem.status).type('application/problem+json').send(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ProblemException) {
      return { ...exception.problem };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const title = STATUS_TITLES[status] ?? exception.message;
      let detail: string | undefined;
      if (typeof body === 'string') {
        detail = body;
      } else {
        const message = (body as { message?: string | string[] }).message;
        detail = Array.isArray(message) ? message.join('; ') : message;
      }
      return {
        type: 'about:blank',
        title,
        status,
        ...(detail !== undefined && detail !== title && { detail }),
      };
    }
    return { type: 'about:blank', title: 'Internal Server Error', status: 500 };
  }
}
```

- [ ] Implement `backend/src/common/json-body.middleware.ts` (COMPLETE file):

```ts
import { json } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ProblemDetails, STATUS_TITLES } from './problem-details';

/** Maps express/body-parser errors to RFC 7807 problems (contracts §4: 400 malformed JSON, 413 too large). */
export function problemFromBodyParserError(err: unknown): ProblemDetails {
  const e = err as { type?: string; status?: number; message?: string };
  if (e.type === 'entity.too.large') {
    return { type: 'about:blank', title: 'Payload Too Large', status: 413, detail: 'Request body exceeds INGEST_MAX_BODY_KB' };
  }
  if (e.type === 'entity.parse.failed') {
    return { type: 'about:blank', title: 'Bad Request', status: 400, detail: 'Malformed JSON body' };
  }
  if (e.type === 'encoding.unsupported') {
    return { type: 'about:blank', title: 'Unsupported Media Type', status: 415, detail: 'Unsupported content encoding' };
  }
  const status = typeof e.status === 'number' ? e.status : 400;
  return { type: 'about:blank', title: STATUS_TITLES[status] ?? 'Bad Request', status, detail: 'Invalid request body' };
}

/**
 * JSON body parser with gzip support (`Content-Encoding: gzip` is inflated by body-parser)
 * and an RFC 7807 error path. Registered in main.ts with bodyParser disabled on the Nest app.
 */
export function jsonBodyParser(maxBodyKb: number): RequestHandler {
  const parser = json({ limit: `${maxBodyKb}kb`, inflate: true, type: 'application/json' });
  return (req: Request, res: Response, next: NextFunction) => {
    parser(req, res, (err?: unknown) => {
      if (!err) {
        next();
        return;
      }
      const problem: ProblemDetails = { ...problemFromBodyParserError(err), instance: req.originalUrl };
      res.status(problem.status).type('application/problem+json').send(problem);
    });
  };
}
```

- [ ] Modify `backend/src/app.module.ts` to register pino (COMPLETE new file content):

```ts
import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.authorization'],
        autoLogging: true,
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      },
    }),
  ],
})
export class AppModule {}
```

- [ ] Modify `backend/src/main.ts` to wire logger, body parser, and global filter (COMPLETE new file content):

```ts
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { jsonBodyParser } from './common/json-body.middleware';
import { ProblemDetailsFilter } from './common/problem-details.filter';

/** Builds the fully wired application. Reused by e2e tests so they exercise production wiring. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  const config = app.get<AppConfig>(APP_CONFIG);
  app.useLogger(app.get(Logger));
  app.use(jsonBodyParser(config.ingestMaxBodyKb));
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port, '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **PASS**: `Tests: 16 passed` (7 config + 5 filter + 4 middleware).
- [ ] Commit:

```bash
git add backend/src
git commit -m "feat(backend): rfc 7807 problem details, gzip json parsing, pino request logging"
```

---

### Task 4: Prisma schema (contracts §6), first migration, PrismaService

**Files:**
- Create: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/` (generated by `prisma migrate dev --name init`)
- Create: `backend/src/prisma/prisma.service.ts`
- Create: `backend/src/prisma/prisma.module.ts`
- Create: `backend/test/jest-integration.config.js`
- Create: `backend/test/integration/helpers/containers.ts`
- Test: `backend/test/integration/prisma.int-spec.ts`

**Interfaces:**
- Produces: `PrismaService extends PrismaClient` (models: `organization`, `user`, `membership`, `invitation`, `project`, `sdkToken`, `refreshToken`; enum `Role { admin, analyst, viewer }`), `PrismaModule` (global)
- Produces test helpers: `startPostgresContainer(): Promise<{ container: StartedPostgreSqlContainer; url: string }>` (runs `prisma migrate deploy`), `startRedisContainer()`, `startClickHouseContainer()` — same signatures, `{ container, url }`
- Consumes: `DATABASE_URL` from config (runtime); Docker (tests).

**Steps:**

- [ ] Create `backend/prisma/schema.prisma` (COMPLETE file — tables exactly per shared contracts §6, UUID v7 per contracts §9):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  admin
  analyst
  viewer
}

model Organization {
  id          String       @id @default(uuid(7)) @db.Uuid
  name        String
  createdAt   DateTime     @default(now()) @map("created_at")
  memberships Membership[]
  invitations Invitation[]
  projects    Project[]

  @@map("organizations")
}

model User {
  id            String         @id @default(uuid(7)) @db.Uuid
  email         String         @unique
  passwordHash  String         @map("password_hash")
  name          String
  createdAt     DateTime       @default(now()) @map("created_at")
  memberships   Membership[]
  refreshTokens RefreshToken[]

  @@map("users")
}

model Membership {
  userId String @map("user_id") @db.Uuid
  orgId  String @map("org_id") @db.Uuid
  role   Role

  user User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  org  Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@id([userId, orgId])
  @@map("memberships")
}

model Invitation {
  id         String   @id @default(uuid(7)) @db.Uuid
  orgId      String   @map("org_id") @db.Uuid
  role       Role
  token      String   @unique
  expiresAt  DateTime @map("expires_at")
  acceptedBy String?  @map("accepted_by") @db.Uuid

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@map("invitations")
}

model Project {
  id        String     @id @default(uuid(7)) @db.Uuid
  orgId     String     @map("org_id") @db.Uuid
  name      String
  timezone  String     @default("UTC")
  createdAt DateTime   @default(now()) @map("created_at")
  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  sdkTokens SdkToken[]

  @@map("projects")
}

model SdkToken {
  id        String    @id @default(uuid(7)) @db.Uuid
  projectId String    @map("project_id") @db.Uuid
  token     String    @unique
  label     String
  revokedAt DateTime? @map("revoked_at")
  createdAt DateTime  @default(now()) @map("created_at")
  project   Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@map("sdk_tokens")
}

model RefreshToken {
  id        String    @id @default(uuid(7)) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  tokenHash String    @map("token_hash")
  expiresAt DateTime  @map("expires_at")
  revokedAt DateTime? @map("revoked_at")
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("refresh_tokens")
}
```

- [ ] Generate the first migration against the local compose Postgres (infra already exists): from repo root run `docker compose -f infra/docker-compose.yml up -d postgres`, then `cd backend && DATABASE_URL=postgresql://myampmix:myampmix_dev@localhost:5432/myampmix pnpm prisma migrate dev --name init && cd ..` — expected: `backend/prisma/migrations/<ts>_init/migration.sql` created, `@prisma/client` generated.
- [ ] Create `backend/test/jest-integration.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  moduleNameMapper: {
    '^@myampmix/contracts$': '<rootDir>/../packages/contracts/src',
  },
  testTimeout: 300000,
};
```

- [ ] Create `backend/test/integration/helpers/containers.ts` (COMPLETE file — Redis/ClickHouse starters are used from Task 5 on; images match contracts §2):

```ts
import { execSync } from 'node:child_process';
import path from 'node:path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

const BACKEND_DIR = path.resolve(__dirname, '..', '..', '..');

export interface StartedService<C> {
  container: C;
  url: string;
}

/** postgres:17-alpine with the Prisma migrations applied (contracts §6). */
export async function startPostgresContainer(): Promise<StartedService<StartedPostgreSqlContainer>> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
  return { container, url };
}

/** redis:7-alpine, no auth (contracts §2). */
export async function startRedisContainer(): Promise<StartedService<StartedTestContainer>> {
  const container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
  return { container, url: `redis://${container.getHost()}:${container.getMappedPort(6379)}` };
}

/** clickhouse/clickhouse-server:24.8 with contracts §2 credentials. */
export async function startClickHouseContainer(): Promise<StartedService<StartedTestContainer>> {
  const container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({
      CLICKHOUSE_USER: 'default',
      CLICKHOUSE_PASSWORD: 'myampmix_dev',
      CLICKHOUSE_DB: 'analytics',
    })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123).forStatusCode(200))
    .start();
  return { container, url: `http://${container.getHost()}:${container.getMappedPort(8123)}` };
}
```

- [ ] Write the failing test `backend/test/integration/prisma.int-spec.ts` (COMPLETE file):

```ts
import { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from './helpers/containers';

describe('Prisma schema (shared contracts §6)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  it('creates org → project → sdk token and enforces token uniqueness', async () => {
    const org = await prisma.organization.create({ data: { name: 'Acme' } });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'App' } });
    expect(project.timezone).toBe('UTC');

    const token = 'mam_' + 'a'.repeat(32);
    const created = await prisma.sdkToken.create({
      data: { projectId: project.id, token, label: 'default' },
    });
    expect(created.revokedAt).toBeNull();

    await expect(
      prisma.sdkToken.create({ data: { projectId: project.id, token, label: 'dup' } }),
    ).rejects.toThrow();
  });

  it('enforces the composite membership pk and role enum', async () => {
    const org = await prisma.organization.create({ data: { name: 'Org2' } });
    const user = await prisma.user.create({
      data: { email: 'a@b.co', passwordHash: 'x', name: 'A' },
    });
    await prisma.membership.create({ data: { userId: user.id, orgId: org.id, role: 'admin' } });
    await expect(
      prisma.membership.create({ data: { userId: user.id, orgId: org.id, role: 'viewer' } }),
    ).rejects.toThrow();
  });

  it('cascades project deletion to sdk tokens', async () => {
    const org = await prisma.organization.create({ data: { name: 'Org3' } });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'Doomed' } });
    await prisma.sdkToken.create({
      data: { projectId: project.id, token: 'mam_' + 'b'.repeat(32), label: 't' },
    });
    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.sdkToken.count({ where: { projectId: project.id } })).toBe(0);
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test:int` — expected **PASS** (the schema/migration already exist from the earlier step; if the migration step was skipped the suite FAILS with `relation "organizations" does not exist` — go back and generate it). TDD note: the failing state for this task is the pre-migration run.
- [ ] Implement `backend/src/prisma/prisma.service.ts` (COMPLETE file):

```ts
import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Cloud Run SIGTERM drain: close the pool inside the 10 s window. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] Implement `backend/src/prisma/prisma.module.ts` (COMPLETE file):

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] Modify `backend/src/app.module.ts`: add `PrismaModule` to the imports array (exact edit — add the import line `import { PrismaModule } from './prisma/prisma.module';` and append `PrismaModule,` after `AppConfigModule,` in `imports`).
- [ ] Run `pnpm --filter @myampmix/backend typecheck` — expected: no errors. Run `pnpm --filter @myampmix/backend test` — expected **PASS** (unit suite unchanged).
- [ ] Commit:

```bash
git add backend/prisma backend/src backend/test
git commit -m "feat(backend): prisma schema per contracts §6 with first migration and prisma service"
```

---

### Task 5: Redis and ClickHouse client wrappers

**Files:**
- Create: `backend/src/redis/redis.module.ts`
- Create: `backend/src/clickhouse/clickhouse.service.ts`
- Create: `backend/src/clickhouse/clickhouse.module.ts`
- Create: `backend/test/integration/helpers/clickhouse-schema.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/clickhouse/clickhouse.service.spec.ts`
- Test: `backend/test/integration/clickhouse.int-spec.ts`
- Test: `backend/test/integration/redis.int-spec.ts`

**Interfaces:**
- Produces: `REDIS = 'REDIS_CLIENT'` (injection token for an `ioredis` `Redis` instance), `RedisModule` (global, closes connection on shutdown)
- Produces: `interface EventRow` (one field per contracts §5 `events` column; `timestamp`/`server_timestamp` as `'YYYY-MM-DD HH:mm:ss.SSS'` strings; `properties: Record<string, unknown>`), `interface ProfileRow { project_id: string; distinct_id: string; properties: Record<string, unknown>; updated_at: string }`, `toChDateTime64(ms: number): string`
- Produces: `class ClickHouseService implements EventSink, OnApplicationShutdown { insertEvents(rows: EventRow[]): Promise<void>; insertProfiles(rows: ProfileRow[]): Promise<void>; query<T>(sql: string, params?: Record<string, unknown>): Promise<T[]>; ping(): Promise<boolean> }`, `interface EventSink { insertEvents(rows: EventRow[]): Promise<void> }`, `ClickHouseModule` (global)
- Produces test helper: `applyClickHouseSchema(client: ClickHouseClient): Promise<void>` (DDL verbatim from contracts §5, `CREATE TABLE IF NOT EXISTS` variant)
- Consumes: `APP_CONFIG`/`AppConfig` (Task 2).

**Steps:**

- [ ] Write the failing unit test `backend/src/clickhouse/clickhouse.service.spec.ts` (COMPLETE file):

```ts
import { toChDateTime64 } from './clickhouse.service';

describe('toChDateTime64', () => {
  it('formats ms epoch as ClickHouse DateTime64(3) UTC literal', () => {
    expect(toChDateTime64(Date.UTC(2026, 6, 2, 12, 0, 0, 123))).toBe('2026-07-02 12:00:00.123');
  });

  it('zero-pads milliseconds', () => {
    expect(toChDateTime64(Date.UTC(2026, 0, 1, 0, 0, 0, 5))).toBe('2026-01-01 00:00:00.005');
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **FAIL**: `Cannot find module './clickhouse.service'`.
- [ ] Implement `backend/src/clickhouse/clickhouse.service.ts` (COMPLETE file):

```ts
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ClickHouseClient, createClient } from '@clickhouse/client';
import { APP_CONFIG, AppConfig } from '../config/app-config';

/** One row of analytics.events — columns exactly per shared contracts §5. */
export interface EventRow {
  project_id: string;
  insert_id: string;
  event: string;
  distinct_id: string;
  anon_id: string;
  session_id: string;
  timestamp: string;
  server_timestamp: string;
  properties: Record<string, unknown>;
  app_version: string;
  app_build: string;
  os: string;
  os_version: string;
  device_model: string;
  device_manufacturer: string;
  locale: string;
  timezone: string;
  screen_width: number;
  screen_height: number;
  network: string;
  sdk_version: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  first_utm_source: string;
  first_utm_campaign: string;
  install_referrer: string;
}

/** One row of analytics.user_profiles (shared contracts §5). */
export interface ProfileRow {
  project_id: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  updated_at: string;
}

/** Writer abstraction so Pub/Sub or a CH cluster can replace direct writes later (master design §2). */
export interface EventSink {
  insertEvents(rows: EventRow[]): Promise<void>;
}

/** Formats a ms epoch as a ClickHouse DateTime64(3) UTC literal: 'YYYY-MM-DD HH:mm:ss.SSS'. */
export function toChDateTime64(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 23);
}

@Injectable()
export class ClickHouseService implements EventSink, OnApplicationShutdown {
  private readonly client: ClickHouseClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = createClient({
      url: config.clickhouse.url,
      username: config.clickhouse.user,
      password: config.clickhouse.password,
      database: config.clickhouse.database,
      clickhouse_settings: {
        // Stateless Cloud Run rule: batching happens inside ClickHouse; the 202 is only
        // returned once ClickHouse durably acked (wait_for_async_insert=1).
        async_insert: 1,
        wait_for_async_insert: 1,
        async_insert_busy_timeout_ms: 1000,
        date_time_input_format: 'best_effort',
      },
    });
  }

  async insertEvents(rows: EventRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.client.insert({ table: 'events', values: rows, format: 'JSONEachRow' });
  }

  async insertProfiles(rows: ProfileRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.client.insert({ table: 'user_profiles', values: rows, format: 'JSONEachRow' });
  }

  /** Parameterized query — user input must always bind via {name:Type} params, never interpolation. */
  async query<T>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const result = await this.client.query({ query: sql, query_params: params, format: 'JSONEachRow' });
    return result.json<T>();
  }

  async ping(): Promise<boolean> {
    const result = await this.client.ping();
    return result.success;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
```

- [ ] Implement `backend/src/clickhouse/clickhouse.module.ts` (COMPLETE file):

```ts
import { Global, Module } from '@nestjs/common';
import { ClickHouseService } from './clickhouse.service';

@Global()
@Module({
  providers: [ClickHouseService],
  exports: [ClickHouseService],
})
export class ClickHouseModule {}
```

- [ ] Implement `backend/src/redis/redis.module.ts` (COMPLETE file):

```ts
import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export const REDIS = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new Redis(config.redisUrl, { maxRetriesPerRequest: 2 }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Cloud Run SIGTERM drain: close the shared connection cleanly. */
  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }
}
```

- [ ] Create `backend/test/integration/helpers/clickhouse-schema.ts` (COMPLETE file — DDL verbatim from shared contracts §5 with `IF NOT EXISTS` added; keep in sync with `infra/clickhouse/init.sql`):

```ts
import type { ClickHouseClient } from '@clickhouse/client';

/** Verbatim from docs/superpowers/specs/2026-07-02-shared-contracts.md §5 (+ IF NOT EXISTS). */
export const CLICKHOUSE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS analytics.events (
    project_id    UUID,
    insert_id     UUID,
    event         LowCardinality(String) CODEC(ZSTD(3)),
    distinct_id   String CODEC(ZSTD(3)),
    anon_id       String CODEC(ZSTD(3)),
    session_id    UUID,
    timestamp     DateTime64(3, 'UTC') CODEC(Delta, ZSTD(3)),
    server_timestamp DateTime64(3, 'UTC') CODEC(Delta, ZSTD(3)),
    properties    JSON,
    app_version   LowCardinality(String), app_build LowCardinality(String),
    os            LowCardinality(String), os_version LowCardinality(String),
    device_model  LowCardinality(String), device_manufacturer LowCardinality(String),
    locale        LowCardinality(String), timezone LowCardinality(String),
    screen_width  UInt16, screen_height UInt16,
    network       LowCardinality(String), sdk_version LowCardinality(String),
    utm_source    LowCardinality(String), utm_medium LowCardinality(String),
    utm_campaign  String, utm_content String, utm_term String,
    first_utm_source LowCardinality(String), first_utm_campaign String,
    install_referrer String CODEC(ZSTD(3))
  )
  ENGINE = ReplacingMergeTree
  PARTITION BY toYYYYMM(timestamp)
  ORDER BY (project_id, event, timestamp, insert_id)`,
  `CREATE TABLE IF NOT EXISTS analytics.user_profiles (
    project_id UUID, distinct_id String,
    properties JSON, updated_at DateTime64(3, 'UTC')
  ) ENGINE = ReplacingMergeTree(updated_at)
  ORDER BY (project_id, distinct_id)`,
  `CREATE TABLE IF NOT EXISTS analytics.identity_mappings (
    project_id UUID, anon_id String, canonical_id String,
    created_at DateTime64(3, 'UTC')
  ) ENGINE = ReplacingMergeTree(created_at)
  ORDER BY (project_id, anon_id)`,
];

export async function applyClickHouseSchema(client: ClickHouseClient): Promise<void> {
  for (const statement of CLICKHOUSE_DDL) {
    await client.command({
      query: statement,
      clickhouse_settings: { allow_experimental_json_type: 1 },
    });
  }
}
```

- [ ] Write the failing integration test `backend/test/integration/clickhouse.int-spec.ts` (COMPLETE file):

```ts
import { createClient, ClickHouseClient } from '@clickhouse/client';
import type { StartedTestContainer } from 'testcontainers';
import { randomUUID } from 'node:crypto';
import { ClickHouseService, EventRow, toChDateTime64 } from '../../src/clickhouse/clickhouse.service';
import type { AppConfig } from '../../src/config/app-config';
import { startClickHouseContainer } from './helpers/containers';
import { applyClickHouseSchema } from './helpers/clickhouse-schema';

function makeConfig(url: string): AppConfig {
  return {
    nodeEnv: 'test',
    port: 8080,
    databaseUrl: 'postgresql://unused',
    clickhouse: { url, user: 'default', password: 'myampmix_dev', database: 'analytics' },
    redisUrl: 'redis://unused',
    jwtAccessSecret: undefined,
    jwtRefreshSecret: undefined,
    ingestMaxBatch: 100,
    ingestMaxBodyKb: 1024,
    ingestRateLimitPerMin: 1000,
  };
}

function makeEventRow(overrides: Partial<EventRow> = {}): EventRow {
  const now = Date.now();
  return {
    project_id: randomUUID(),
    insert_id: randomUUID(),
    event: 'checkout_completed',
    distinct_id: 'u_42',
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: toChDateTime64(now),
    server_timestamp: toChDateTime64(now),
    properties: { plan: 'pro', value: 9.99 },
    app_version: '1.4.2',
    app_build: '142',
    os: 'ios',
    os_version: '18.5',
    device_model: 'iPhone16,2',
    device_manufacturer: 'Apple',
    locale: 'fr_FR',
    timezone: 'Europe/Paris',
    screen_width: 393,
    screen_height: 852,
    network: 'wifi',
    sdk_version: '0.1.0',
    utm_source: 'tiktok',
    utm_medium: 'paid',
    utm_campaign: 'summer',
    utm_content: '',
    utm_term: '',
    first_utm_source: 'meta',
    first_utm_campaign: 'launch',
    install_referrer: '',
    ...overrides,
  };
}

describe('ClickHouseService (integration)', () => {
  let container: StartedTestContainer;
  let admin: ClickHouseClient;
  let service: ClickHouseService;

  beforeAll(async () => {
    const started = await startClickHouseContainer();
    container = started.container;
    admin = createClient({
      url: started.url,
      username: 'default',
      password: 'myampmix_dev',
      database: 'analytics',
    });
    await applyClickHouseSchema(admin);
    service = new ClickHouseService(makeConfig(started.url));
  });

  afterAll(async () => {
    await service.onApplicationShutdown();
    await admin.close();
    await container.stop();
  });

  it('pings', async () => {
    expect(await service.ping()).toBe(true);
  });

  it('inserts events with async_insert ack and collapses duplicates by insert_id', async () => {
    const row = makeEventRow();
    await service.insertEvents([row]);
    await service.insertEvents([row]); // simulated SDK retry of the same batch

    const rows = await service.query<{ n: string }>(
      'SELECT count(DISTINCT insert_id) AS n FROM events WHERE project_id = {p:UUID}',
      { p: row.project_id },
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it('round-trips the properties JSON column', async () => {
    const row = makeEventRow();
    await service.insertEvents([row]);
    const rows = await service.query<{ properties: { plan: string; value: number } }>(
      'SELECT properties FROM events WHERE project_id = {p:UUID} LIMIT 1',
      { p: row.project_id },
    );
    expect(rows[0].properties.plan).toBe('pro');
  });

  it('writes user_profiles rows where the latest updated_at wins', async () => {
    const projectId = randomUUID();
    await service.insertProfiles([
      { project_id: projectId, distinct_id: 'u_1', properties: { plan: 'free' }, updated_at: toChDateTime64(Date.now() - 1000) },
      { project_id: projectId, distinct_id: 'u_1', properties: { plan: 'pro' }, updated_at: toChDateTime64(Date.now()) },
    ]);
    const rows = await service.query<{ properties: { plan: string } }>(
      'SELECT properties FROM user_profiles FINAL WHERE project_id = {p:UUID} AND distinct_id = {d:String}',
      { p: projectId, d: 'u_1' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].properties.plan).toBe('pro');
  });
});
```

- [ ] Write `backend/test/integration/redis.int-spec.ts` (COMPLETE file):

```ts
import Redis from 'ioredis';
import type { StartedTestContainer } from 'testcontainers';
import { startRedisContainer } from './helpers/containers';

describe('Redis client (integration)', () => {
  let container: StartedTestContainer;
  let redis: Redis;

  beforeAll(async () => {
    const started = await startRedisContainer();
    container = started.container;
    redis = new Redis(started.url, { maxRetriesPerRequest: 2 });
  });

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  it('pings and round-trips a key with TTL', async () => {
    expect(await redis.ping()).toBe('PONG');
    await redis.set('k', 'v', 'EX', 60);
    expect(await redis.get('k')).toBe('v');
    expect(await redis.ttl('k')).toBeGreaterThan(0);
  });
});
```

- [ ] Modify `backend/src/app.module.ts`: add imports `import { RedisModule } from './redis/redis.module';` and `import { ClickHouseModule } from './clickhouse/clickhouse.module';`, and append `RedisModule, ClickHouseModule,` to the `imports` array after `PrismaModule,`.
- [ ] Run `pnpm --filter @myampmix/backend test` — expected **PASS** (18 unit tests). Run `pnpm --filter @myampmix/backend test:int` — expected **PASS**: prisma + clickhouse + redis suites green (first run pulls images; allow several minutes).
- [ ] Commit:

```bash
git add backend/src backend/test
git commit -m "feat(backend): redis provider and clickhouse async-insert client wrapper"
```

---

### Task 6: SDK-token auth guard with Redis cache

**Files:**
- Create: `backend/src/ingestion/ingest-auth.ts`
- Create: `backend/src/ingestion/sdk-token.guard.ts`
- Test: `backend/src/ingestion/sdk-token.guard.spec.ts`

**Interfaces:**
- Produces: `interface IngestAuthContext { projectId: string; token: string }`, `interface IngestRequest extends Request { ingestAuth?: IngestAuthContext }`
- Produces: `class SdkTokenGuard implements CanActivate` — `constructor(redis: Redis /* @Inject(REDIS) */, prisma: PrismaService)`; on success sets `req.ingestAuth`; throws `ProblemException(401)` otherwise
- Produces: `sdkTokenCacheKey(token: string): string` (= `` `sdk_token:${token}` ``; phase 2's revoke endpoint DELs this key for immediate revocation), `SDK_TOKEN_CACHE_TTL_SECONDS = 60`
- Consumes: `REDIS` (Task 5), `PrismaService` (Task 4), `ProblemException` (Task 3), `SDK_TOKEN_REGEX` (Task 1).

**Steps:**

- [ ] Create `backend/src/ingestion/ingest-auth.ts` (COMPLETE file):

```ts
import type { Request } from 'express';

export interface IngestAuthContext {
  projectId: string;
  token: string;
}

export interface IngestRequest extends Request {
  ingestAuth?: IngestAuthContext;
}
```

- [ ] Write the failing test `backend/src/ingestion/sdk-token.guard.spec.ts` (COMPLETE file):

```ts
import type { ExecutionContext } from '@nestjs/common';
import type Redis from 'ioredis';
import type { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { SdkTokenGuard, sdkTokenCacheKey } from './sdk-token.guard';

const TOKEN = 'mam_' + 'a1b2c3d4'.repeat(4);
const PROJECT_ID = '018f6b2e-0000-7000-8000-000000000001';

class FakeRedis {
  store = new Map<string, string>();
  ttls = new Map<string, number>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, _ex: string, ttl: number): Promise<'OK'> {
    this.store.set(key, value);
    this.ttls.set(key, ttl);
    return 'OK';
  }
}

function makeGuard(opts: { cached?: string; dbRow?: { projectId: string; revokedAt: Date | null } | null }) {
  const redis = new FakeRedis();
  if (opts.cached !== undefined) redis.store.set(sdkTokenCacheKey(TOKEN), opts.cached);
  const findUnique = jest.fn().mockResolvedValue(opts.dbRow ?? null);
  const prisma = { sdkToken: { findUnique } } as unknown as PrismaService;
  const guard = new SdkTokenGuard(redis as unknown as Redis, prisma);
  return { guard, redis, findUnique };
}

function ctxFor(headers: Record<string, string>): { ctx: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = { headers };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('SdkTokenGuard', () => {
  it('rejects a missing Authorization header with a 401 problem', async () => {
    const { guard } = makeGuard({});
    const { ctx } = ctxFor({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(ProblemException);
  });

  it('rejects a malformed token without touching redis or postgres', async () => {
    const { guard, findUnique } = makeGuard({});
    const { ctx } = ctxFor({ authorization: 'Bearer not-a-token' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ problem: { status: 401 } });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('serves a cached valid token without a postgres lookup', async () => {
    const { guard, findUnique } = makeGuard({ cached: JSON.stringify({ projectId: PROJECT_ID }) });
    const { ctx, req } = ctxFor({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.ingestAuth).toEqual({ projectId: PROJECT_ID, token: TOKEN });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a cached-negative token without a postgres lookup', async () => {
    const { guard, findUnique } = makeGuard({ cached: JSON.stringify({ projectId: null }) });
    const { ctx } = ctxFor({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ProblemException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('looks up postgres on cache miss and caches the positive result for 60s', async () => {
    const { guard, redis, findUnique } = makeGuard({ dbRow: { projectId: PROJECT_ID, revokedAt: null } });
    const { ctx, req } = ctxFor({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({ where: { token: TOKEN } });
    expect(req.ingestAuth).toEqual({ projectId: PROJECT_ID, token: TOKEN });
    expect(redis.store.get(sdkTokenCacheKey(TOKEN))).toBe(JSON.stringify({ projectId: PROJECT_ID }));
    expect(redis.ttls.get(sdkTokenCacheKey(TOKEN))).toBe(60);
  });

  it('rejects and caches-negative a revoked token', async () => {
    const { guard, redis } = makeGuard({ dbRow: { projectId: PROJECT_ID, revokedAt: new Date() } });
    const { ctx } = ctxFor({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ProblemException);
    expect(redis.store.get(sdkTokenCacheKey(TOKEN))).toBe(JSON.stringify({ projectId: null }));
  });

  it('rejects and caches-negative an unknown token', async () => {
    const { guard, redis } = makeGuard({ dbRow: null });
    const { ctx } = ctxFor({ authorization: `Bearer ${TOKEN}` });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ProblemException);
    expect(redis.store.get(sdkTokenCacheKey(TOKEN))).toBe(JSON.stringify({ projectId: null }));
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **FAIL**: `Cannot find module './sdk-token.guard'`.
- [ ] Implement `backend/src/ingestion/sdk-token.guard.ts` (COMPLETE file):

```ts
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { SDK_TOKEN_REGEX } from '@myampmix/contracts';
import { REDIS } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import type { IngestRequest } from './ingest-auth';

export function sdkTokenCacheKey(token: string): string {
  return `sdk_token:${token}`;
}

/** Revocation staleness bound: a revoked token stays valid at most this long unless the
 *  revoke path DELs the cache key (projects module, phase 2). */
export const SDK_TOKEN_CACHE_TTL_SECONDS = 60;

interface CachedLookup {
  projectId: string | null;
}

/**
 * Authenticates /ingest requests: `Authorization: Bearer mam_<32hex>` (contracts §4).
 * Hot path: Redis cache (60 s, negative results cached too) in front of Postgres sdk_tokens.
 */
@Injectable()
export class SdkTokenGuard implements CanActivate {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IngestRequest>();
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token || !SDK_TOKEN_REGEX.test(token)) {
      throw this.unauthorized();
    }

    const cached = await this.redis.get(sdkTokenCacheKey(token));
    if (cached !== null) {
      const lookup = JSON.parse(cached) as CachedLookup;
      if (!lookup.projectId) throw this.unauthorized();
      req.ingestAuth = { projectId: lookup.projectId, token };
      return true;
    }

    const row = await this.prisma.sdkToken.findUnique({ where: { token } });
    const projectId = row !== null && row.revokedAt === null ? row.projectId : null;
    await this.redis.set(
      sdkTokenCacheKey(token),
      JSON.stringify({ projectId }),
      'EX',
      SDK_TOKEN_CACHE_TTL_SECONDS,
    );
    if (!projectId) throw this.unauthorized();
    req.ingestAuth = { projectId, token };
    return true;
  }

  private unauthorized(): ProblemException {
    return new ProblemException({
      status: 401,
      title: 'Unauthorized',
      detail: 'Missing, invalid, or revoked SDK token',
    });
  }
}
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **PASS**: `Tests: 25 passed`.
- [ ] Commit:

```bash
git add backend/src/ingestion
git commit -m "feat(backend): sdk token ingest guard with 60s redis cache and negative caching"
```

---

### Task 7: Distributed sliding-window rate limiter (Redis)

**Files:**
- Create: `backend/src/ingestion/rate-limiter.ts`
- Create: `backend/src/ingestion/rate-limit.guard.ts`
- Test: `backend/src/ingestion/rate-limit.guard.spec.ts`
- Test: `backend/test/integration/rate-limiter.int-spec.ts`

**Interfaces:**
- Produces: `interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSeconds: number }`, `RATE_LIMIT_WINDOW_MS = 60_000`, `class SlidingWindowRateLimiter { constructor(redis: Redis /* @Inject(REDIS) */); consume(key: string, limit: number, windowMs?: number): Promise<RateLimitResult> }`
- Produces: `class IngestRateLimitGuard implements CanActivate` — runs after `SdkTokenGuard`, keys the window on `` `ingest:${req.ingestAuth.token}` `` with limit `config.ingestRateLimitPerMin` (contracts §4: 1000 req/min per token); throws `ProblemException(429, retryAfterSeconds)` when exhausted
- Consumes: `REDIS` (Task 5), `APP_CONFIG`/`AppConfig` (Task 2), `ProblemException` (Task 3), `IngestRequest` (Task 6).

**Steps:**

- [ ] Write the failing unit test `backend/src/ingestion/rate-limit.guard.spec.ts` (COMPLETE file):

```ts
import type { ExecutionContext } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { ProblemException } from '../common/problem-details';
import { IngestRateLimitGuard } from './rate-limit.guard';
import type { SlidingWindowRateLimiter } from './rate-limiter';

const TOKEN = 'mam_' + 'a'.repeat(32);
const config = { ingestRateLimitPerMin: 1000 } as AppConfig;

function ctxFor(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('IngestRateLimitGuard', () => {
  it('allows requests under the limit, keyed per token', async () => {
    const consume = jest.fn().mockResolvedValue({ allowed: true, remaining: 999, retryAfterSeconds: 0 });
    const guard = new IngestRateLimitGuard({ consume } as unknown as SlidingWindowRateLimiter, config);
    const ctx = ctxFor({ ingestAuth: { projectId: 'p1', token: TOKEN } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(consume).toHaveBeenCalledWith(`ingest:${TOKEN}`, 1000);
  });

  it('throws a 429 problem carrying retryAfterSeconds when the limit is exceeded', async () => {
    const consume = jest.fn().mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    const guard = new IngestRateLimitGuard({ consume } as unknown as SlidingWindowRateLimiter, config);
    const ctx = ctxFor({ ingestAuth: { projectId: 'p1', token: TOKEN } });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      problem: { status: 429, title: 'Too Many Requests' },
      retryAfterSeconds: 42,
    });
  });

  it('throws a 401 problem when ingestAuth is missing (guard-order safety net)', async () => {
    const consume = jest.fn();
    const guard = new IngestRateLimitGuard({ consume } as unknown as SlidingWindowRateLimiter, config);
    await expect(guard.canActivate(ctxFor({}))).rejects.toThrow(ProblemException);
    expect(consume).not.toHaveBeenCalled();
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **FAIL**: `Cannot find module './rate-limit.guard'`.
- [ ] Implement `backend/src/ingestion/rate-limiter.ts` (COMPLETE file):

```ts
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Distributed sliding-window rate limiter (contracts §4: 1000 req/min per token).
 * State lives in a Redis ZSET (`rl:<key>`, score = ms timestamp), so any number of
 * stateless Cloud Run instances share one window. One MULTI keeps it near-atomic;
 * an over-limit probe removes its own member so denied requests do not consume quota.
 */
@Injectable()
export class SlidingWindowRateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowMs: number = RATE_LIMIT_WINDOW_MS): Promise<RateLimitResult> {
    const now = Date.now();
    const member = `${now}-${randomUUID()}`;
    const redisKey = `rl:${key}`;

    const results = await this.redis
      .multi()
      .zremrangebyscore(redisKey, 0, now - windowMs)
      .zadd(redisKey, now, member)
      .zcard(redisKey)
      .pexpire(redisKey, windowMs)
      .exec();
    if (!results) {
      throw new Error('rate limiter transaction failed');
    }
    const count = results[2][1] as number;

    if (count > limit) {
      await this.redis.zrem(redisKey, member);
      const oldest = await this.redis.zrange(redisKey, 0, 0, 'WITHSCORES');
      const oldestScore = oldest.length === 2 ? Number(oldest[1]) : now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestScore + windowMs - now) / 1000));
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
  }
}
```

- [ ] Implement `backend/src/ingestion/rate-limit.guard.ts` (COMPLETE file):

```ts
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ProblemException } from '../common/problem-details';
import { SlidingWindowRateLimiter } from './rate-limiter';
import type { IngestRequest } from './ingest-auth';

/** Runs after SdkTokenGuard (decorator order in @UseGuards is preserved by Nest). */
@Injectable()
export class IngestRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: SlidingWindowRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IngestRequest>();
    const auth = req.ingestAuth;
    if (!auth) {
      throw new ProblemException({
        status: 401,
        title: 'Unauthorized',
        detail: 'Missing ingest authentication context',
      });
    }
    const result = await this.limiter.consume(`ingest:${auth.token}`, this.config.ingestRateLimitPerMin);
    if (!result.allowed) {
      throw new ProblemException({
        status: 429,
        title: 'Too Many Requests',
        detail: `Rate limit of ${this.config.ingestRateLimitPerMin} requests per minute per token exceeded`,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    return true;
  }
}
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **PASS**: `Tests: 28 passed`.
- [ ] Write the integration test `backend/test/integration/rate-limiter.int-spec.ts` (COMPLETE file):

```ts
import Redis from 'ioredis';
import type { StartedTestContainer } from 'testcontainers';
import { SlidingWindowRateLimiter } from '../../src/ingestion/rate-limiter';
import { startRedisContainer } from './helpers/containers';

describe('SlidingWindowRateLimiter (integration)', () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let limiter: SlidingWindowRateLimiter;

  beforeAll(async () => {
    const started = await startRedisContainer();
    container = started.container;
    redis = new Redis(started.url, { maxRetriesPerRequest: 2 });
    limiter = new SlidingWindowRateLimiter(redis);
  });

  afterAll(async () => {
    await redis.quit();
    await container.stop();
  });

  it('allows up to the limit inside the window, then denies with a retry hint', async () => {
    const key = 'ingest:test-token-1';
    const first = await limiter.consume(key, 3, 1500);
    const second = await limiter.consume(key, 3, 1500);
    const third = await limiter.consume(key, 3, 1500);
    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, true]);
    expect(first.remaining).toBe(2);
    expect(third.remaining).toBe(0);

    const fourth = await limiter.consume(key, 3, 1500);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('allows again once the window slides past the old entries', async () => {
    const key = 'ingest:test-token-2';
    for (let i = 0; i < 3; i += 1) {
      await limiter.consume(key, 3, 1500);
    }
    expect((await limiter.consume(key, 3, 1500)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect((await limiter.consume(key, 3, 1500)).allowed).toBe(true);
  });

  it('tracks independent windows per key', async () => {
    expect((await limiter.consume('ingest:token-a', 1, 1500)).allowed).toBe(true);
    expect((await limiter.consume('ingest:token-b', 1, 1500)).allowed).toBe(true);
    expect((await limiter.consume('ingest:token-a', 1, 1500)).allowed).toBe(false);
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test:int` — expected **PASS**: all integration suites green (prisma, clickhouse, redis, rate-limiter).
- [ ] Commit:

```bash
git add backend/src/ingestion backend/test/integration
git commit -m "feat(backend): redis sliding-window rate limiter and 429 ingest guard"
```

---

### Task 8: Event normalizer — per-item validation, timestamp clamping, row mapping

**Files:**
- Create: `backend/src/ingestion/event-normalizer.ts`
- Test: `backend/src/ingestion/event-normalizer.spec.ts`

**Interfaces:**
- Produces: `TIMESTAMP_PAST_LIMIT_MS = 7*24*60*60*1000`, `TIMESTAMP_FUTURE_LIMIT_MS = 5*60*1000`, `clampTimestamp(clientTs: number, nowMs: number): number` (clamp to `[now−7d, now+5min]`, contracts §4), `formatZodReason(error: ZodError): string` (missing field → `` `missing ${path}` `` matching the contract example `"missing insert_id"`; otherwise `` `${path}: ${message}` ``)
- Produces: `interface NormalizedBatch { rows: EventRow[]; rejected: RejectedItem[] }`, `class EventNormalizer { normalizeBatch(projectId: string, items: unknown[], nowMs?: number): NormalizedBatch }` — per-item accept/reject, never all-or-nothing; sets `server_timestamp = nowMs`; context strings default `''`, ints `0`, `properties` `{}` (matching contracts §5 column types)
- Consumes: `ingestEventSchema`, `IngestEvent`, `RejectedItem` (Task 1), `EventRow`, `toChDateTime64` (Task 5).

**Steps:**

- [ ] Write the failing test `backend/src/ingestion/event-normalizer.spec.ts` (COMPLETE file):

```ts
import { randomUUID } from 'node:crypto';
import {
  clampTimestamp,
  EventNormalizer,
  TIMESTAMP_FUTURE_LIMIT_MS,
  TIMESTAMP_PAST_LIMIT_MS,
} from './event-normalizer';

const PROJECT_ID = '018f6b2e-0000-7000-8000-000000000001';
const NOW = Date.UTC(2026, 6, 2, 12, 0, 0, 0); // 2026-07-02T12:00:00.000Z

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    insert_id: '018f6b2e-7c1a-7f3b-9c4d-1a2b3c4d5e6f',
    event: 'checkout_completed',
    distinct_id: 'u_42',
    anon_id: '018f6b2e-aaaa-7f3b-9c4d-1a2b3c4d5e6f',
    session_id: '018f6b2e-bbbb-7f3b-9c4d-1a2b3c4d5e6f',
    timestamp: NOW - 1000,
    properties: { plan: 'pro', value: 9.99 },
    context: { os: 'ios', app_version: '1.4.2', screen_width: 393, utm_content: null },
    ...overrides,
  };
}

describe('clampTimestamp', () => {
  it('passes through in-range timestamps', () => {
    expect(clampTimestamp(NOW - 1000, NOW)).toBe(NOW - 1000);
  });

  it('clamps timestamps older than 7 days to now-7d', () => {
    expect(clampTimestamp(0, NOW)).toBe(NOW - TIMESTAMP_PAST_LIMIT_MS);
  });

  it('clamps timestamps more than 5 minutes ahead to now+5min', () => {
    expect(clampTimestamp(NOW + 3_600_000, NOW)).toBe(NOW + TIMESTAMP_FUTURE_LIMIT_MS);
  });
});

describe('EventNormalizer.normalizeBatch', () => {
  const normalizer = new EventNormalizer();

  it('maps a valid event to a ClickHouse row with authoritative server_timestamp', () => {
    const { rows, rejected } = normalizer.normalizeBatch(PROJECT_ID, [makeEvent()], NOW);
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      project_id: PROJECT_ID,
      insert_id: '018f6b2e-7c1a-7f3b-9c4d-1a2b3c4d5e6f',
      event: 'checkout_completed',
      distinct_id: 'u_42',
      timestamp: '2026-07-02 11:59:59.000',
      server_timestamp: '2026-07-02 12:00:00.000',
      properties: { plan: 'pro', value: 9.99 },
      os: 'ios',
      app_version: '1.4.2',
      screen_width: 393,
      utm_content: '',
    });
  });

  it('fills contract defaults for missing context and properties', () => {
    const { rows } = normalizer.normalizeBatch(
      PROJECT_ID,
      [makeEvent({ properties: undefined, context: undefined })],
      NOW,
    );
    expect(rows[0].properties).toEqual({});
    expect(rows[0].os).toBe('');
    expect(rows[0].screen_width).toBe(0);
    expect(rows[0].install_referrer).toBe('');
  });

  it('rejects an item missing insert_id with the contract reason style', () => {
    const { insert_id, ...bad } = makeEvent();
    const { rows, rejected } = normalizer.normalizeBatch(PROJECT_ID, [bad], NOW);
    expect(rows).toEqual([]);
    expect(rejected).toEqual([{ index: 0, reason: 'missing insert_id' }]);
  });

  it('rejects an item with a non-uuid insert_id naming the field', () => {
    const { rejected } = normalizer.normalizeBatch(PROJECT_ID, [makeEvent({ insert_id: 'nope' })], NOW);
    expect(rejected[0].reason).toMatch(/^insert_id/);
  });

  it('accepts valid items around rejected ones — never all-or-nothing', () => {
    const good1 = makeEvent();
    const good2 = makeEvent({ insert_id: randomUUID() });
    const { rows, rejected } = normalizer.normalizeBatch(PROJECT_ID, [good1, { event: 'orphan' }, good2], NOW);
    expect(rows).toHaveLength(2);
    expect(rejected).toEqual([{ index: 1, reason: 'missing insert_id' }]);
  });

  it('clamps stale client timestamps to now-7d in the emitted row', () => {
    const { rows } = normalizer.normalizeBatch(PROJECT_ID, [makeEvent({ timestamp: 1 })], NOW);
    expect(rows[0].timestamp).toBe('2026-06-25 12:00:00.000');
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **FAIL**: `Cannot find module './event-normalizer'`.
- [ ] Implement `backend/src/ingestion/event-normalizer.ts` (COMPLETE file):

```ts
import { Injectable } from '@nestjs/common';
import type { ZodError } from 'zod';
import { IngestEvent, RejectedItem, ingestEventSchema } from '@myampmix/contracts';
import { EventRow, toChDateTime64 } from '../clickhouse/clickhouse.service';

/** Contracts §4: client timestamp is clamped to [now-7d, now+5min]. */
export const TIMESTAMP_PAST_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
export const TIMESTAMP_FUTURE_LIMIT_MS = 5 * 60 * 1000;

export function clampTimestamp(clientTs: number, nowMs: number): number {
  return Math.min(Math.max(clientTs, nowMs - TIMESTAMP_PAST_LIMIT_MS), nowMs + TIMESTAMP_FUTURE_LIMIT_MS);
}

/** Contract-style reject reasons: "missing insert_id" for absent fields, "field: message" otherwise. */
export function formatZodReason(error: ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.join('.') || 'item';
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return `missing ${path}`;
  }
  return `${path}: ${issue.message}`;
}

export interface NormalizedBatch {
  rows: EventRow[];
  rejected: RejectedItem[];
}

/** Validates and normalizes a raw batch item-by-item (contracts §4: never all-or-nothing). */
@Injectable()
export class EventNormalizer {
  normalizeBatch(projectId: string, items: unknown[], nowMs: number = Date.now()): NormalizedBatch {
    const rows: EventRow[] = [];
    const rejected: RejectedItem[] = [];
    items.forEach((item, index) => {
      const parsed = ingestEventSchema.safeParse(item);
      if (!parsed.success) {
        rejected.push({ index, reason: formatZodReason(parsed.error) });
        return;
      }
      rows.push(this.toRow(projectId, parsed.data, nowMs));
    });
    return { rows, rejected };
  }

  private toRow(projectId: string, event: IngestEvent, nowMs: number): EventRow {
    const ctx = event.context ?? {};
    const str = (value: string | null | undefined): string => value ?? '';
    return {
      project_id: projectId,
      insert_id: event.insert_id,
      event: event.event,
      distinct_id: event.distinct_id,
      anon_id: event.anon_id,
      session_id: event.session_id,
      timestamp: toChDateTime64(clampTimestamp(event.timestamp, nowMs)),
      server_timestamp: toChDateTime64(nowMs),
      properties: event.properties ?? {},
      app_version: str(ctx.app_version),
      app_build: str(ctx.app_build),
      os: str(ctx.os),
      os_version: str(ctx.os_version),
      device_model: str(ctx.device_model),
      device_manufacturer: str(ctx.device_manufacturer),
      locale: str(ctx.locale),
      timezone: str(ctx.timezone),
      screen_width: ctx.screen_width ?? 0,
      screen_height: ctx.screen_height ?? 0,
      network: str(ctx.network),
      sdk_version: str(ctx.sdk_version),
      utm_source: str(ctx.utm_source),
      utm_medium: str(ctx.utm_medium),
      utm_campaign: str(ctx.utm_campaign),
      utm_content: str(ctx.utm_content),
      utm_term: str(ctx.utm_term),
      first_utm_source: str(ctx.first_utm_source),
      first_utm_campaign: str(ctx.first_utm_campaign),
      install_referrer: str(ctx.install_referrer),
    };
  }
}
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **PASS**: `Tests: 37 passed`.
- [ ] Commit:

```bash
git add backend/src/ingestion
git commit -m "feat(backend): event normalizer with per-item validation and timestamp clamping"
```

---

### Task 9: POST /ingest/events endpoint (contracts §4) + e2e stack

**Files:**
- Create: `backend/src/ingestion/ingest.controller.ts`
- Create: `backend/src/ingestion/ingest.module.ts`
- Create: `backend/test/jest-e2e.config.js`
- Create: `backend/test/e2e/helpers/stack.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/e2e/ingest-events.e2e-spec.ts`

**Interfaces:**
- Produces: `IngestController` — `POST /ingest/events` guarded by `@UseGuards(SdkTokenGuard, IngestRateLimitGuard)`, returns `202 IngestResponse`; private `parseEnvelope(body: unknown, schema: ZodTypeAny, field: 'events' | 'operations'): unknown[]` (400 problem on bad envelope, 400 problem when `items.length > config.ingestMaxBatch`); `IngestModule`
- Produces test helpers: `interface TestStack { app: INestApplication; prisma: PrismaClient; ch: ClickHouseClient; projectId: string; sdkToken: string; stop(): Promise<void> }`, `startTestStack(envOverrides?: Record<string, string>): Promise<TestStack>` — boots all three containers, applies migrations + ClickHouse DDL, calls the production `createApp()`, seeds org/project/sdk token
- Consumes: `EventNormalizer` (Task 8), `ClickHouseService` (Task 5), `SdkTokenGuard` (Task 6), `IngestRateLimitGuard` (Task 7), `ingestEventsRequestSchema`/`IngestResponse` (Task 1), `createApp` (Task 3), container helpers (Tasks 4–5).

**Steps:**

- [ ] Create `backend/test/jest-e2e.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  moduleNameMapper: {
    '^@myampmix/contracts$': '<rootDir>/../packages/contracts/src',
  },
  testTimeout: 300000,
};
```

- [ ] Create `backend/test/e2e/helpers/stack.ts` (COMPLETE file):

```ts
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ClickHouseClient, createClient } from '@clickhouse/client';
import { createApp } from '../../../src/main';
import {
  startClickHouseContainer,
  startPostgresContainer,
  startRedisContainer,
} from '../../integration/helpers/containers';
import { applyClickHouseSchema } from '../../integration/helpers/clickhouse-schema';

export interface TestStack {
  app: INestApplication;
  prisma: PrismaClient;
  ch: ClickHouseClient;
  projectId: string;
  sdkToken: string;
  stop(): Promise<void>;
}

/**
 * Boots the REAL application (production createApp wiring) against real
 * ClickHouse + Postgres + Redis containers, with a seeded project + sdk token.
 */
export async function startTestStack(envOverrides: Record<string, string> = {}): Promise<TestStack> {
  const [pg, chc, redis] = await Promise.all([
    startPostgresContainer(),
    startClickHouseContainer(),
    startRedisContainer(),
  ]);

  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: '8080',
    DATABASE_URL: pg.url,
    CLICKHOUSE_URL: chc.url,
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: 'myampmix_dev',
    CLICKHOUSE_DB: 'analytics',
    REDIS_URL: redis.url,
    INGEST_MAX_BATCH: '100',
    INGEST_MAX_BODY_KB: '1024',
    INGEST_RATE_LIMIT_PER_MIN: '1000',
    ...envOverrides,
  });

  const ch = createClient({
    url: chc.url,
    username: 'default',
    password: 'myampmix_dev',
    database: 'analytics',
  });
  await applyClickHouseSchema(ch);

  const app = await createApp();
  await app.init();

  const prisma = new PrismaClient({ datasources: { db: { url: pg.url } } });
  const org = await prisma.organization.create({ data: { name: 'e2e-org' } });
  const project = await prisma.project.create({ data: { orgId: org.id, name: 'e2e-app' } });
  const sdkToken = 'mam_' + randomBytes(16).toString('hex');
  await prisma.sdkToken.create({ data: { projectId: project.id, token: sdkToken, label: 'e2e' } });

  return {
    app,
    prisma,
    ch,
    projectId: project.id,
    sdkToken,
    stop: async () => {
      await app.close(); // exercises onApplicationShutdown hooks (prisma/redis/clickhouse close)
      await prisma.$disconnect();
      await ch.close();
      await Promise.all([pg.container.stop(), chc.container.stop(), redis.container.stop()]);
    },
  };
}
```

- [ ] Write the failing e2e test `backend/test/e2e/ingest-events.e2e-spec.ts` (COMPLETE file):

```ts
import request from 'supertest';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import type { ClickHouseClient } from '@clickhouse/client';
import { startTestStack, TestStack } from './helpers/stack';

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    insert_id: randomUUID(),
    event: 'checkout_completed',
    distinct_id: 'u_42',
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: Date.now(),
    properties: { plan: 'pro', value: 9.99 },
    context: { os: 'ios', app_version: '1.4.2' },
    ...overrides,
  };
}

async function countDistinct(ch: ClickHouseClient, insertId: string): Promise<number> {
  const rs = await ch.query({
    query: 'SELECT count(DISTINCT insert_id) AS n FROM events WHERE insert_id = {id:UUID}',
    query_params: { id: insertId },
    format: 'JSONEachRow',
  });
  const rows = await rs.json<{ n: string }>();
  return Number(rows[0].n);
}

describe('POST /ingest/events (e2e)', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('accepts valid items and rejects invalid ones per-item with 202', async () => {
    const good = makeEvent();
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events: [good, { event: 'missing_everything' }] })
      .expect(202);
    expect(res.body).toEqual({ accepted: 1, rejected: [{ index: 1, reason: 'missing insert_id' }] });
    expect(await countDistinct(stack.ch, good.insert_id as string)).toBe(1);
  });

  it('accepts gzip-encoded bodies (Content-Encoding: gzip)', async () => {
    const good = makeEvent();
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send(gzipSync(JSON.stringify({ events: [good] })))
      .expect(202);
    expect(res.body.accepted).toBe(1);
    expect(await countDistinct(stack.ch, good.insert_id as string)).toBe(1);
  });

  it('returns a 400 problem for malformed JSON', async () => {
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .set('Content-Type', 'application/json')
      .send('{"events": [')
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 400, title: 'Bad Request', detail: 'Malformed JSON body' });
  });

  it('returns a 400 problem for a missing or empty events array', async () => {
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ nope: [] })
      .expect(400);
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events: [] })
      .expect(400);
  });

  it('returns a 400 problem when the batch exceeds INGEST_MAX_BATCH=100', async () => {
    const events = Array.from({ length: 101 }, () => makeEvent());
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events })
      .expect(400);
    expect(res.body.detail).toContain('INGEST_MAX_BATCH=100');
  });

  it('clamps stale client timestamps to now-7d and stamps server_timestamp', async () => {
    const stale = makeEvent({ timestamp: 1000 });
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events: [stale] })
      .expect(202);

    const rs = await stack.ch.query({
      query:
        'SELECT toUnixTimestamp64Milli(timestamp) AS ts, toUnixTimestamp64Milli(server_timestamp) AS sts ' +
        'FROM events WHERE insert_id = {id:UUID} LIMIT 1',
      query_params: { id: stale.insert_id },
      format: 'JSONEachRow',
    });
    const [row] = await rs.json<{ ts: string; sts: string }>();
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    expect(Number(row.ts)).toBeGreaterThan(sevenDaysAgo - 60_000);
    expect(Number(row.ts)).toBeLessThan(sevenDaysAgo + 60_000);
    expect(Math.abs(Number(row.sts) - now)).toBeLessThan(60_000);
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test:e2e` — expected **FAIL**: `expected 202 "Accepted", got 404 "Not Found"` (no controller yet).
- [ ] Implement `backend/src/ingestion/ingest.controller.ts` (COMPLETE file — the profiles endpoint is added in Task 10):

```ts
import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { IngestResponse, ingestEventsRequestSchema } from '@myampmix/contracts';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { ProblemException } from '../common/problem-details';
import { EventNormalizer } from './event-normalizer';
import { SdkTokenGuard } from './sdk-token.guard';
import { IngestRateLimitGuard } from './rate-limit.guard';
import type { IngestRequest } from './ingest-auth';

@Controller('ingest')
@UseGuards(SdkTokenGuard, IngestRateLimitGuard)
export class IngestController {
  constructor(
    private readonly normalizer: EventNormalizer,
    private readonly clickhouse: ClickHouseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('events')
  @HttpCode(202)
  async ingestEvents(@Body() body: unknown, @Req() req: IngestRequest): Promise<IngestResponse> {
    const items = this.parseEnvelope(body, ingestEventsRequestSchema, 'events');
    const { rows, rejected } = this.normalizer.normalizeBatch(req.ingestAuth!.projectId, items);
    await this.clickhouse.insertEvents(rows);
    return { accepted: rows.length, rejected };
  }

  private parseEnvelope(body: unknown, schema: ZodTypeAny, field: 'events' | 'operations'): unknown[] {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ProblemException({
        status: 400,
        title: 'Bad Request',
        detail: `Body must be an object with a non-empty "${field}" array`,
      });
    }
    const items = (parsed.data as Record<string, unknown[]>)[field];
    if (items.length > this.config.ingestMaxBatch) {
      throw new ProblemException({
        status: 400,
        title: 'Bad Request',
        detail: `Batch exceeds INGEST_MAX_BATCH=${this.config.ingestMaxBatch} items`,
      });
    }
    return items;
  }
}
```

- [ ] Implement `backend/src/ingestion/ingest.module.ts` (COMPLETE file):

```ts
import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { EventNormalizer } from './event-normalizer';
import { SdkTokenGuard } from './sdk-token.guard';
import { IngestRateLimitGuard } from './rate-limit.guard';
import { SlidingWindowRateLimiter } from './rate-limiter';

@Module({
  controllers: [IngestController],
  providers: [EventNormalizer, SdkTokenGuard, IngestRateLimitGuard, SlidingWindowRateLimiter],
})
export class IngestModule {}
```

- [ ] Modify `backend/src/app.module.ts`: add `import { IngestModule } from './ingestion/ingest.module';` and append `IngestModule,` to the `imports` array after `ClickHouseModule,`.
- [ ] Run `pnpm --filter @myampmix/backend test:e2e` — expected **PASS**: `Tests: 6 passed` (first run pulls three container images; allow several minutes).
- [ ] Run `pnpm --filter @myampmix/backend test` — expected **PASS**: `Tests: 37 passed` (unit suite untouched).
- [ ] Commit:

```bash
git add backend/src backend/test
git commit -m "feat(backend): POST /ingest/events per contracts §4 with gzip, per-item 202, clamping"
```

---

### Task 10: Profile operations + POST /ingest/profiles (contracts §4)

**Files:**
- Create: `backend/src/ingestion/profile-writer.ts`
- Modify: `backend/src/ingestion/ingest.controller.ts`
- Modify: `backend/src/ingestion/ingest.module.ts`
- Test: `backend/src/ingestion/profile-writer.spec.ts`
- Test: `backend/test/e2e/ingest-profiles.e2e-spec.ts`

**Interfaces:**
- Produces: `applyOperation(current: Record<string, unknown>, op: ProfileOperation): Record<string, unknown>` (pure; `set`/`set_once`/`increment`/`append`/`unset`/`delete`, never mutates input), `class ProfileWriter { constructor(clickhouse: ClickHouseService); apply(projectId: string, operations: ProfileOperation[], nowMs?: number): Promise<void> }` — groups ops per `distinct_id`, reads current state with `SELECT ... FINAL`, applies ops in `timestamp` order, writes one `ProfileRow` per user (ReplacingMergeTree(updated_at): latest wins)
- Produces: `POST /ingest/profiles` on `IngestController` — same guards, envelope, batch limit, per-item accept/reject, `202 IngestResponse`
- Consumes: `ClickHouseService`/`ProfileRow`/`toChDateTime64` (Task 5), `profileOperationSchema`/`ProfileOperation`/`ingestProfilesRequestSchema`/`RejectedItem` (Task 1), `formatZodReason` (Task 8), `parseEnvelope` (Task 9).

**Steps:**

- [ ] Write the failing unit test `backend/src/ingestion/profile-writer.spec.ts` (COMPLETE file):

```ts
import type { ProfileOperation } from '@myampmix/contracts';
import type { ClickHouseService, ProfileRow } from '../clickhouse/clickhouse.service';
import { applyOperation, ProfileWriter } from './profile-writer';

const PROJECT_ID = '018f6b2e-0000-7000-8000-000000000001';
const NOW = Date.UTC(2026, 6, 2, 12, 0, 0, 0);

function op(partial: Partial<ProfileOperation> & Pick<ProfileOperation, 'op'>): ProfileOperation {
  return { distinct_id: 'u_1', timestamp: 1, ...partial } as ProfileOperation;
}

describe('applyOperation', () => {
  it('set overwrites and adds keys', () => {
    expect(applyOperation({ plan: 'free', a: 1 }, op({ op: 'set', properties: { plan: 'pro', b: 2 } }))).toEqual({
      plan: 'pro',
      a: 1,
      b: 2,
    });
  });

  it('set_once only fills missing keys', () => {
    expect(
      applyOperation({ plan: 'free' }, op({ op: 'set_once', properties: { plan: 'pro', source: 'ad' } })),
    ).toEqual({ plan: 'free', source: 'ad' });
  });

  it('increment adds to numeric values and starts absent keys from 0', () => {
    expect(applyOperation({ count: 2 }, op({ op: 'increment', properties: { count: 3, fresh: 5 } }))).toEqual({
      count: 5,
      fresh: 5,
    });
  });

  it('increment treats non-numeric deltas and bases as 0', () => {
    expect(applyOperation({ count: 2, label: 'x' }, op({ op: 'increment', properties: { count: 'nope', label: 3 } }))).toEqual({
      count: 2,
      label: 3,
    });
  });

  it('append pushes onto arrays, creating them when absent', () => {
    expect(applyOperation({ tags: ['a'] }, op({ op: 'append', properties: { tags: 'b', other: 'x' } }))).toEqual({
      tags: ['a', 'b'],
      other: ['x'],
    });
  });

  it('unset removes the named keys (values ignored)', () => {
    expect(applyOperation({ a: 1, b: 2 }, op({ op: 'unset', properties: { a: null } }))).toEqual({ b: 2 });
  });

  it('delete clears the profile', () => {
    expect(applyOperation({ a: 1, b: 2 }, op({ op: 'delete' }))).toEqual({});
  });

  it('never mutates the input object', () => {
    const current = { a: 1 };
    applyOperation(current, op({ op: 'set', properties: { a: 2 } }));
    applyOperation(current, op({ op: 'unset', properties: { a: null } }));
    expect(current).toEqual({ a: 1 });
  });
});

describe('ProfileWriter.apply', () => {
  it('groups ops per distinct_id, applies them in timestamp order, writes one row per user', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const insertProfiles = jest.fn().mockResolvedValue(undefined);
    const writer = new ProfileWriter({ query, insertProfiles } as unknown as ClickHouseService);

    await writer.apply(
      PROJECT_ID,
      [
        { distinct_id: 'u_1', op: 'set', properties: { plan: 'free' }, timestamp: 2 },
        { distinct_id: 'u_1', op: 'set', properties: { plan: 'pro' }, timestamp: 1 }, // older — applied first
        { distinct_id: 'u_2', op: 'set', properties: { plan: 'max' }, timestamp: 3 },
      ],
      NOW,
    );

    expect(insertProfiles).toHaveBeenCalledTimes(1);
    const rows = insertProfiles.mock.calls[0][0] as ProfileRow[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.distinct_id === 'u_1')?.properties).toEqual({ plan: 'free' }); // ts=2 wins
    expect(rows.find((r) => r.distinct_id === 'u_2')?.properties).toEqual({ plan: 'max' });
    expect(rows[0].updated_at).toBe('2026-07-02 12:00:00.000');
  });

  it('merges onto the current profile fetched with FINAL', async () => {
    const query = jest.fn().mockResolvedValue([{ properties: { plan: 'free', seats: 1 } }]);
    const insertProfiles = jest.fn().mockResolvedValue(undefined);
    const writer = new ProfileWriter({ query, insertProfiles } as unknown as ClickHouseService);

    await writer.apply(PROJECT_ID, [{ distinct_id: 'u_1', op: 'increment', properties: { seats: 2 }, timestamp: 1 }], NOW);

    expect(query.mock.calls[0][0]).toContain('FINAL');
    const rows = insertProfiles.mock.calls[0][0] as ProfileRow[];
    expect(rows[0].properties).toEqual({ plan: 'free', seats: 3 });
  });

  it('does nothing for an empty operation list', async () => {
    const query = jest.fn();
    const insertProfiles = jest.fn();
    const writer = new ProfileWriter({ query, insertProfiles } as unknown as ClickHouseService);
    await writer.apply(PROJECT_ID, [], NOW);
    expect(query).not.toHaveBeenCalled();
    expect(insertProfiles).not.toHaveBeenCalled();
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **FAIL**: `Cannot find module './profile-writer'`.
- [ ] Implement `backend/src/ingestion/profile-writer.ts` (COMPLETE file):

```ts
import { Injectable } from '@nestjs/common';
import type { ProfileOperation } from '@myampmix/contracts';
import { ClickHouseService, ProfileRow, toChDateTime64 } from '../clickhouse/clickhouse.service';

/** Pure profile-op semantics (contracts §4). Never mutates `current`. */
export function applyOperation(current: Record<string, unknown>, op: ProfileOperation): Record<string, unknown> {
  const props = op.properties ?? {};
  switch (op.op) {
    case 'set':
      return { ...current, ...props };
    case 'set_once': {
      const next = { ...current };
      for (const [key, value] of Object.entries(props)) {
        if (!(key in next)) next[key] = value;
      }
      return next;
    }
    case 'increment': {
      const next = { ...current };
      for (const [key, value] of Object.entries(props)) {
        const delta = typeof value === 'number' ? value : 0;
        const base = typeof next[key] === 'number' ? (next[key] as number) : 0;
        next[key] = base + delta;
      }
      return next;
    }
    case 'append': {
      const next = { ...current };
      for (const [key, value] of Object.entries(props)) {
        const base = Array.isArray(next[key]) ? (next[key] as unknown[]) : [];
        next[key] = [...base, value];
      }
      return next;
    }
    case 'unset': {
      const next = { ...current };
      for (const key of Object.keys(props)) {
        delete next[key];
      }
      return next;
    }
    case 'delete':
      return {};
  }
}

/**
 * Applies profile operations: read current state (SELECT ... FINAL), fold ops in
 * timestamp order, write one new user_profiles row per user. ReplacingMergeTree(updated_at)
 * keeps the latest row; profile ops are rare relative to events, so the read is acceptable.
 */
@Injectable()
export class ProfileWriter {
  constructor(private readonly clickhouse: ClickHouseService) {}

  async apply(projectId: string, operations: ProfileOperation[], nowMs: number = Date.now()): Promise<void> {
    if (operations.length === 0) return;

    const byUser = new Map<string, ProfileOperation[]>();
    for (const operation of operations) {
      const list = byUser.get(operation.distinct_id) ?? [];
      list.push(operation);
      byUser.set(operation.distinct_id, list);
    }

    const rows: ProfileRow[] = [];
    for (const [distinctId, ops] of byUser) {
      let properties = (await this.fetchCurrent(projectId, distinctId)) ?? {};
      const ordered = [...ops].sort((a, b) => a.timestamp - b.timestamp);
      for (const operation of ordered) {
        properties = applyOperation(properties, operation);
      }
      rows.push({
        project_id: projectId,
        distinct_id: distinctId,
        properties,
        updated_at: toChDateTime64(nowMs),
      });
    }
    await this.clickhouse.insertProfiles(rows);
  }

  private async fetchCurrent(projectId: string, distinctId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.clickhouse.query<{ properties: Record<string, unknown> }>(
      'SELECT properties FROM user_profiles FINAL WHERE project_id = {projectId:UUID} AND distinct_id = {distinctId:String} LIMIT 1',
      { projectId, distinctId },
    );
    return rows[0]?.properties ?? null;
  }
}
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **PASS**: `Tests: 48 passed`.
- [ ] Write the failing e2e test `backend/test/e2e/ingest-profiles.e2e-spec.ts` (COMPLETE file):

```ts
import request from 'supertest';
import { startTestStack, TestStack } from './helpers/stack';

describe('POST /ingest/profiles (e2e)', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack();
  });

  afterAll(async () => {
    await stack.stop();
  });

  async function fetchProfile(distinctId: string): Promise<Record<string, unknown> | undefined> {
    const rs = await stack.ch.query({
      query:
        'SELECT properties FROM user_profiles FINAL WHERE project_id = {p:UUID} AND distinct_id = {d:String}',
      query_params: { p: stack.projectId, d: distinctId },
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{ properties: Record<string, unknown> }>();
    return rows[0]?.properties;
  }

  function post(operations: unknown[]) {
    return request(stack.app.getHttpServer())
      .post('/ingest/profiles')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ operations });
  }

  it('applies set / set_once / increment / append in one request (202)', async () => {
    const res = await post([
      { distinct_id: 'u_100', op: 'set', properties: { plan: 'free', seats: 1 }, timestamp: 1 },
      { distinct_id: 'u_100', op: 'set_once', properties: { plan: 'pro', source: 'ad' }, timestamp: 2 },
      { distinct_id: 'u_100', op: 'increment', properties: { seats: 2 }, timestamp: 3 },
      { distinct_id: 'u_100', op: 'append', properties: { tags: 'beta' }, timestamp: 4 },
    ]).expect(202);
    expect(res.body).toEqual({ accepted: 4, rejected: [] });
    expect(await fetchProfile('u_100')).toEqual({ plan: 'free', seats: 3, source: 'ad', tags: ['beta'] });
  });

  it('merges follow-up requests onto the stored profile and supports unset/delete', async () => {
    await post([{ distinct_id: 'u_101', op: 'set', properties: { a: 1, b: 2 }, timestamp: 1 }]).expect(202);
    await post([{ distinct_id: 'u_101', op: 'unset', properties: { a: null }, timestamp: 2 }]).expect(202);
    expect(await fetchProfile('u_101')).toEqual({ b: 2 });
    await post([{ distinct_id: 'u_101', op: 'delete', timestamp: 3 }]).expect(202);
    expect(await fetchProfile('u_101')).toEqual({});
  });

  it('rejects invalid operations per-item and still applies the valid ones', async () => {
    const res = await post([
      { distinct_id: 'u_102', op: 'merge', properties: {}, timestamp: 1 },
      { distinct_id: 'u_102', op: 'set', properties: { x: 1 }, timestamp: 2 },
    ]).expect(202);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].index).toBe(0);
    expect(res.body.rejected[0].reason).toMatch(/^op/);
    expect(await fetchProfile('u_102')).toEqual({ x: 1 });
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test:e2e` — expected **FAIL**: `expected 202 "Accepted", got 404 "Not Found"` for the profiles suite (events suite still passes).
- [ ] Modify `backend/src/ingestion/ingest.controller.ts` (COMPLETE new file content — adds `ProfileWriter` and the profiles endpoint):

```ts
import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import {
  IngestResponse,
  ProfileOperation,
  RejectedItem,
  ingestEventsRequestSchema,
  ingestProfilesRequestSchema,
  profileOperationSchema,
} from '@myampmix/contracts';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { ProblemException } from '../common/problem-details';
import { EventNormalizer, formatZodReason } from './event-normalizer';
import { ProfileWriter } from './profile-writer';
import { SdkTokenGuard } from './sdk-token.guard';
import { IngestRateLimitGuard } from './rate-limit.guard';
import type { IngestRequest } from './ingest-auth';

@Controller('ingest')
@UseGuards(SdkTokenGuard, IngestRateLimitGuard)
export class IngestController {
  constructor(
    private readonly normalizer: EventNormalizer,
    private readonly profileWriter: ProfileWriter,
    private readonly clickhouse: ClickHouseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('events')
  @HttpCode(202)
  async ingestEvents(@Body() body: unknown, @Req() req: IngestRequest): Promise<IngestResponse> {
    const items = this.parseEnvelope(body, ingestEventsRequestSchema, 'events');
    const { rows, rejected } = this.normalizer.normalizeBatch(req.ingestAuth!.projectId, items);
    await this.clickhouse.insertEvents(rows);
    return { accepted: rows.length, rejected };
  }

  @Post('profiles')
  @HttpCode(202)
  async ingestProfiles(@Body() body: unknown, @Req() req: IngestRequest): Promise<IngestResponse> {
    const items = this.parseEnvelope(body, ingestProfilesRequestSchema, 'operations');
    const operations: ProfileOperation[] = [];
    const rejected: RejectedItem[] = [];
    items.forEach((item, index) => {
      const parsed = profileOperationSchema.safeParse(item);
      if (!parsed.success) {
        rejected.push({ index, reason: formatZodReason(parsed.error) });
        return;
      }
      operations.push(parsed.data);
    });
    await this.profileWriter.apply(req.ingestAuth!.projectId, operations);
    return { accepted: operations.length, rejected };
  }

  private parseEnvelope(body: unknown, schema: ZodTypeAny, field: 'events' | 'operations'): unknown[] {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ProblemException({
        status: 400,
        title: 'Bad Request',
        detail: `Body must be an object with a non-empty "${field}" array`,
      });
    }
    const items = (parsed.data as Record<string, unknown[]>)[field];
    if (items.length > this.config.ingestMaxBatch) {
      throw new ProblemException({
        status: 400,
        title: 'Bad Request',
        detail: `Batch exceeds INGEST_MAX_BATCH=${this.config.ingestMaxBatch} items`,
      });
    }
    return items;
  }
}
```

- [ ] Modify `backend/src/ingestion/ingest.module.ts` (COMPLETE new file content):

```ts
import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { EventNormalizer } from './event-normalizer';
import { ProfileWriter } from './profile-writer';
import { SdkTokenGuard } from './sdk-token.guard';
import { IngestRateLimitGuard } from './rate-limit.guard';
import { SlidingWindowRateLimiter } from './rate-limiter';

@Module({
  controllers: [IngestController],
  providers: [EventNormalizer, ProfileWriter, SdkTokenGuard, IngestRateLimitGuard, SlidingWindowRateLimiter],
})
export class IngestModule {}
```

- [ ] Run `pnpm --filter @myampmix/backend test:e2e` — expected **PASS**: `Tests: 9 passed` (6 events + 3 profiles).
- [ ] Run `pnpm --filter @myampmix/backend test` — expected **PASS**: `Tests: 48 passed`.
- [ ] Commit:

```bash
git add backend/src backend/test
git commit -m "feat(backend): POST /ingest/profiles with set/set_once/increment/append/unset/delete"
```

---

### Task 11: Health endpoints + graceful SIGTERM shutdown

**Files:**
- Create: `backend/src/health/health.controller.ts`
- Create: `backend/src/health/health.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/health/health.controller.spec.ts`
- Test: `backend/src/redis/redis.module.spec.ts`

**Interfaces:**
- Produces: `HealthController` — `GET /health` → `200 { status: 'ok' }` (liveness, zero I/O; Cloud Run probe target), `GET /health/ready` → `200 { status: 'ready', checks: { postgres, clickhouse, redis } }` or `503 { status: 'unavailable', checks }` when any probe fails; `HealthModule`
- Shutdown chain (already implemented, verified here): `main.ts` `app.enableShutdownHooks()` → on SIGTERM Nest drains in-flight HTTP, then `onApplicationShutdown` runs `PrismaService.$disconnect()` (Task 4), `RedisModule.redis.quit()` (Task 5), `ClickHouseService.client.close()` (Task 5) — all inside Cloud Run's 10 s window
- Consumes: `PrismaService` (Task 4), `ClickHouseService`, `REDIS` (Task 5).

**Steps:**

- [ ] Write the failing test `backend/src/health/health.controller.spec.ts` (COMPLETE file):

```ts
import type { Response } from 'express';
import type Redis from 'ioredis';
import type { ClickHouseService } from '../clickhouse/clickhouse.service';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

function makeController(overrides: { pgFails?: boolean; chDown?: boolean; redisFails?: boolean } = {}) {
  const prisma = {
    $queryRaw: overrides.pgFails
      ? jest.fn().mockRejectedValue(new Error('down'))
      : jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  } as unknown as PrismaService;
  const clickhouse = { ping: jest.fn().mockResolvedValue(!overrides.chDown) } as unknown as ClickHouseService;
  const redis = {
    ping: overrides.redisFails
      ? jest.fn().mockRejectedValue(new Error('down'))
      : jest.fn().mockResolvedValue('PONG'),
  } as unknown as Redis;
  return new HealthController(prisma, clickhouse, redis);
}

function mockRes(): { res: Response; statusCalls: number[] } {
  const statusCalls: number[] = [];
  const res = {
    status(code: number) {
      statusCalls.push(code);
      return res;
    },
  } as unknown as Response;
  return { res, statusCalls };
}

describe('HealthController', () => {
  it('live always returns ok without touching dependencies', () => {
    expect(makeController().live()).toEqual({ status: 'ok' });
  });

  it('ready reports all checks true when every dependency is up', async () => {
    const { res, statusCalls } = mockRes();
    const body = await makeController().ready(res);
    expect(body).toEqual({ status: 'ready', checks: { postgres: true, clickhouse: true, redis: true } });
    expect(statusCalls).toEqual([]);
  });

  it('ready returns 503 when clickhouse ping fails', async () => {
    const { res, statusCalls } = mockRes();
    const body = await makeController({ chDown: true }).ready(res);
    expect(body.status).toBe('unavailable');
    expect(body.checks.clickhouse).toBe(false);
    expect(statusCalls).toEqual([503]);
  });

  it('ready returns 503 when postgres is down', async () => {
    const { res, statusCalls } = mockRes();
    const body = await makeController({ pgFails: true }).ready(res);
    expect(body.checks.postgres).toBe(false);
    expect(statusCalls).toEqual([503]);
  });

  it('ready returns 503 when redis is down', async () => {
    const { res, statusCalls } = mockRes();
    const body = await makeController({ redisFails: true }).ready(res);
    expect(body.checks.redis).toBe(false);
    expect(statusCalls).toEqual([503]);
  });
});
```

- [ ] Write the failing test `backend/src/redis/redis.module.spec.ts` (COMPLETE file):

```ts
import type Redis from 'ioredis';
import { RedisModule } from './redis.module';

describe('RedisModule graceful shutdown', () => {
  it('quits the connection on application shutdown', async () => {
    const redis = { status: 'ready', quit: jest.fn().mockResolvedValue('OK') } as unknown as Redis;
    await new RedisModule(redis).onApplicationShutdown();
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });

  it('skips quit when the connection is already closed', async () => {
    const redis = { status: 'end', quit: jest.fn() } as unknown as Redis;
    await new RedisModule(redis).onApplicationShutdown();
    expect(redis.quit).not.toHaveBeenCalled();
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **FAIL**: `Cannot find module './health.controller'` (the redis.module suite passes immediately — the shutdown hook exists since Task 5; it is locked in here).
- [ ] Implement `backend/src/health/health.controller.ts` (COMPLETE file):

```ts
import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { REDIS } from '../redis/redis.module';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: no I/O — Cloud Run should only restart the instance if the process is wedged. */
  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: real dependency probes; 503 keeps traffic away until all pools are usable. */
  @Get('ready')
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string; checks: Record<string, boolean> }> {
    const [postgres, clickhouse, redis] = await Promise.all([
      this.check(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      this.check(async () => {
        if (!(await this.clickhouse.ping())) throw new Error('clickhouse ping failed');
      }),
      this.check(async () => {
        await this.redis.ping();
      }),
    ]);
    const ready = postgres && clickhouse && redis;
    if (!ready) {
      res.status(503);
    }
    return { status: ready ? 'ready' : 'unavailable', checks: { postgres, clickhouse, redis } };
  }

  private async check(probe: () => Promise<void>): Promise<boolean> {
    try {
      await probe();
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] Implement `backend/src/health/health.module.ts` (COMPLETE file):

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] Modify `backend/src/app.module.ts` (COMPLETE new file content — final phase-1 shape):

```ts
import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { ClickHouseModule } from './clickhouse/clickhouse.module';
import { IngestModule } from './ingestion/ingest.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.authorization'],
        autoLogging: true,
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      },
    }),
    PrismaModule,
    RedisModule,
    ClickHouseModule,
    IngestModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] Run `pnpm --filter @myampmix/backend test` — expected **PASS**: `Tests: 55 passed` (48 + 5 health + 2 shutdown).
- [ ] Manual SIGTERM check (optional but recommended): `docker compose -f infra/docker-compose.yml up -d`, `pnpm --filter @myampmix/backend start:dev`, then `kill -TERM <pid>` — expected: process logs shutdown and exits 0 within ~2 s (drained connections, closed pools).
- [ ] Commit:

```bash
git add backend/src
git commit -m "feat(backend): health/readiness endpoints and graceful sigterm shutdown"
```

---

### Task 12: Hardening e2e — auth matrix, rate limit, dedup, body limit — and the coverage gate

**Files:**
- Test: `backend/test/e2e/ingest-hardening.e2e-spec.ts`

**Interfaces:**
- Consumes: `startTestStack(envOverrides)` (Task 9) with `INGEST_RATE_LIMIT_PER_MIN=5` and `INGEST_MAX_BODY_KB=2` so 429/413 are cheap to trigger; everything else is the production wiring.
- Produces: nothing new — this task proves the contract end to end and locks the 85% coverage floor.

**Steps:**

- [ ] Write the e2e test `backend/test/e2e/ingest-hardening.e2e-spec.ts` (COMPLETE file):

```ts
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ClickHouseClient } from '@clickhouse/client';
import { startTestStack, TestStack } from './helpers/stack';

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    insert_id: randomUUID(),
    event: 'checkout_completed',
    distinct_id: 'u_42',
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: Date.now(),
    ...overrides,
  };
}

async function countDistinct(ch: ClickHouseClient, insertId: string): Promise<number> {
  const rs = await ch.query({
    query: 'SELECT count(DISTINCT insert_id) AS n FROM events WHERE insert_id = {id:UUID}',
    query_params: { id: insertId },
    format: 'JSONEachRow',
  });
  const rows = await rs.json<{ n: string }>();
  return Number(rows[0].n);
}

// Test order matters: the stack runs with INGEST_RATE_LIMIT_PER_MIN=5 and only requests
// that pass the auth guard consume the limiter. 401s (auth guard rejects first) and 413s
// (body parser rejects before any guard) consume nothing. Budget: dedup uses slots 1-2,
// the final test uses slots 3-5 and then trips slot 6.
describe('/ingest hardening (e2e): auth, limits, dedup, health', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack({ INGEST_RATE_LIMIT_PER_MIN: '5', INGEST_MAX_BODY_KB: '2' });
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('401 problem without an Authorization header', async () => {
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .send({ events: [makeEvent()] })
      .expect(401)
      .expect('Content-Type', /application\/problem\+json/);
    expect(res.body).toMatchObject({ type: 'about:blank', title: 'Unauthorized', status: 401 });
  });

  it('401 problem for a malformed token', async () => {
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', 'Bearer not-a-token')
      .send({ events: [makeEvent()] })
      .expect(401);
  });

  it('401 problem for a well-formed but unknown token', async () => {
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', 'Bearer mam_' + 'f'.repeat(32))
      .send({ events: [makeEvent()] })
      .expect(401);
  });

  it('401 problem for a revoked token', async () => {
    const revoked = 'mam_' + randomBytes(16).toString('hex');
    await stack.prisma.sdkToken.create({
      data: { projectId: stack.projectId, token: revoked, label: 'revoked', revokedAt: new Date() },
    });
    await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${revoked}`)
      .send({ events: [makeEvent()] })
      .expect(401);
  });

  it('413 problem when the body exceeds INGEST_MAX_BODY_KB', async () => {
    const fat = makeEvent({ properties: { pad: 'x'.repeat(4096) } });
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events: [fat] })
      .expect(413)
      .expect('Content-Type', /application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 413, title: 'Payload Too Large' });
  });

  it('deduplicates a retried batch by insert_id (2 requests, 1 logical event)', async () => {
    const event = makeEvent();
    const send = () =>
      request(stack.app.getHttpServer())
        .post('/ingest/events')
        .set('Authorization', `Bearer ${stack.sdkToken}`)
        .send({ events: [event] })
        .expect(202);
    await send(); // rate-limit slot 1
    await send(); // rate-limit slot 2 — simulated SDK retry after a network timeout
    // Dedup is eventual (ReplacingMergeTree); exactness queries always use count(DISTINCT insert_id).
    expect(await countDistinct(stack.ch, event.insert_id as string)).toBe(1);
  });

  it('health endpoints report live and ready with all dependencies up', async () => {
    const live = await request(stack.app.getHttpServer()).get('/health').expect(200);
    expect(live.body).toEqual({ status: 'ok' });
    const ready = await request(stack.app.getHttpServer()).get('/health/ready').expect(200);
    expect(ready.body).toEqual({ status: 'ready', checks: { postgres: true, clickhouse: true, redis: true } });
  });

  it('429 problem with Retry-After once the sliding window is exhausted', async () => {
    // Rate-limit slots 3, 4, 5.
    for (let i = 0; i < 3; i += 1) {
      await request(stack.app.getHttpServer())
        .post('/ingest/events')
        .set('Authorization', `Bearer ${stack.sdkToken}`)
        .send({ events: [makeEvent()] })
        .expect(202);
    }
    // Slot 6 → denied.
    const res = await request(stack.app.getHttpServer())
      .post('/ingest/events')
      .set('Authorization', `Bearer ${stack.sdkToken}`)
      .send({ events: [makeEvent()] })
      .expect(429)
      .expect('Content-Type', /application\/problem\+json/);
    expect(res.body).toMatchObject({ type: 'about:blank', title: 'Too Many Requests', status: 429 });
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Run `pnpm --filter @myampmix/backend test:e2e` — expected **PASS**: `Tests: 17 passed` (6 events + 3 profiles + 8 hardening). No implementation change should be needed; if any hardening test fails, fix the implementation (not the test) — every assertion is a direct contracts §4 requirement.
- [ ] Run the coverage gate: `pnpm --filter @myampmix/backend test:cov` — expected **PASS** with `All files` lines coverage ≥ 85% (jest exits non-zero below the `coverageThreshold`, which is the CI gate).
- [ ] Full verification sweep (all must pass):

```bash
pnpm --filter @myampmix/contracts test && pnpm --filter @myampmix/contracts build
pnpm --filter @myampmix/backend typecheck
pnpm --filter @myampmix/backend test:cov
pnpm --filter @myampmix/backend test:int
pnpm --filter @myampmix/backend test:e2e
pnpm --filter @myampmix/backend build
```

- [ ] Commit:

```bash
git add backend/test
git commit -m "test(backend): e2e hardening for auth matrix, rate limit, insert_id dedup, body limit"
```

---

## Success Criteria (phase-1 done means ALL of these)

**Commands (all green):**
- `pnpm --filter @myampmix/contracts test` and `build` pass.
- `pnpm --filter @myampmix/backend typecheck`, `test:cov` (≥ 85% lines, threshold-enforced), `test:int`, `test:e2e`, `build` all pass. Integration/e2e run against real `clickhouse/clickhouse-server:24.8`, `postgres:17-alpine`, `redis:7-alpine` via Testcontainers.

**Contract behaviors (proven by the suites above):**
- `POST /ingest/events` and `POST /ingest/profiles`: `Bearer mam_<32hex>` auth (401 for missing/malformed/unknown/revoked, with a 60 s Redis cache and negative caching), 1000 req/min per-token Redis sliding window (429 + `Retry-After`; test-only env override), gzip request bodies, per-item accept/reject with `202 {accepted, rejected:[{index, reason}]}` (never all-or-nothing), `"missing insert_id"`-style reasons, batch cap `INGEST_MAX_BATCH=100` (400) and body cap `INGEST_MAX_BODY_KB=1024` (413), client timestamps clamped to `[now−7d, now+5min]` with authoritative `server_timestamp`.
- ClickHouse writes use `async_insert=1, wait_for_async_insert=1`; a retried batch collapses on `insert_id` and `count(DISTINCT insert_id)` returns 1.
- Profile ops `set/set_once/increment/append/unset/delete` fold onto the stored profile (`SELECT ... FINAL`, latest `updated_at` wins).
- Every error response is RFC 7807 `application/problem+json`.
- Postgres schema matches contracts §6 exactly (one committed Prisma migration).

**Operational behaviors:**
- Boot crashes with a clear message on missing/invalid env (verified for missing `DATABASE_URL` and JWT secrets outside `NODE_ENV=test`); defaults `PORT=8080`, `INGEST_MAX_BATCH=100`, `INGEST_MAX_BODY_KB=1024` applied.
- `GET /health` is I/O-free 200; `GET /health/ready` probes Postgres/ClickHouse/Redis and 503s with per-check booleans.
- SIGTERM drains in-flight requests and closes the Prisma pool, Redis connection, and ClickHouse client (exercised by `app.close()` in every e2e teardown).
- pino JSON logs carry a request id (honoring inbound `x-request-id`, echoing it back) and redact `authorization`.
- No files created or modified outside `backend/` and `packages/contracts/`; all commits follow Conventional Commits.

**Explicitly out of scope for phase 1:** `/api/v1` dashboard endpoints, JWT auth flows, identity-mapping writes, query engine, BullMQ worker, metrics endpoint, OpenAPI emission (phases 2–3 per the backend design spec).

