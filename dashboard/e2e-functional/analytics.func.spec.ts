import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { trackPageErrors } from './fixtures/console-errors';

/**
 * Functional, end-to-end, NO-MOCK test: proves the Phase-3 core analytics pages (contracts §14 —
 * the Insights query engine, live feed, users explorer, sessions summary) show CORRECT data,
 * end to end, against the REAL backend (NestJS + Postgres + ClickHouse + Redis, all started by
 * scripts/functional-test.sh) — exactly as a human dashboard user and a mobile SDK would produce it.
 *
 * Journey: sign up through the UI (auto-provisions org + Default project + ingest token, contracts
 * §12) -> read the ingest token off the project detail page -> ingest a DETERMINISTIC dataset
 * (2 distinct users, so total vs. per-user counts are independently checkable) plus one profile
 * `set` op straight against POST /ingest/events + /ingest/profiles, exactly as a mobile SDK would
 * -> drive the real Insights query builder to prove a `total` aggregation AND an `os` breakdown
 * produce the EXACT counts ClickHouse holds -> the live feed shows the freshly ingested events ->
 * the users explorer lists both distinct users with exact per-user event counts, and a user's
 * profile page shows the set profile property plus its exact recent-events timeline -> the
 * sessions page shows the exact session count and avg duration derived from `$session_end`'s
 * `$duration_ms` property.
 *
 * Contracts: docs/superpowers/specs/2026-07-02-shared-contracts.md §4 (ingest), §12 (projects),
 * §14 (core analytics API — Phase 3).
 */

const INGEST_EVENTS_URL = 'http://localhost:8080/ingest/events';
const INGEST_PROFILES_URL = 'http://localhost:8080/ingest/profiles';

/** Mobile device/app context shared by every fake event (contracts §4); `os` is the one field the
 *  Insights breakdown assertion below actually depends on. */
function mobileContext(os: 'ios' | 'android') {
  return {
    os,
    os_version: os === 'ios' ? '18.5' : '14',
    app_version: '2.0.0',
    device_model: os === 'ios' ? 'iPhone 15' : 'Pixel 8',
    device_manufacturer: os === 'ios' ? 'Apple' : 'Google',
    locale: 'en_US',
    network: 'wifi',
    sdk_version: '0.1.0',
  };
}

interface FakeEvent {
  insert_id: string;
  event: string;
  distinct_id: string;
  anon_id: string;
  session_id: string;
  timestamp: number;
  properties?: Record<string, unknown>;
  context: ReturnType<typeof mobileContext>;
}

function makeEvent(
  event: string,
  distinctId: string,
  sessionId: string,
  os: 'ios' | 'android',
  properties?: Record<string, unknown>,
): FakeEvent {
  return {
    insert_id: randomUUID(),
    event,
    distinct_id: distinctId,
    anon_id: `anon_${distinctId}`,
    session_id: sessionId,
    timestamp: Date.now(),
    ...(properties ? { properties } : {}),
    context: mobileContext(os),
  };
}

test('real user journey: ingest a known dataset, Insights/live/users/sessions show correct data', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  let authEstablished = false;
  trackPageErrors(page, 'user', errors, () => authEstablished);

  const email = `analytics_${Date.now()}@example.com`;
  const password = 'correct-horse-battery-9';
  const name = 'Grace Hopper';

  // ---- Step 1: sign up through the UI. Auto-provisions org + Default project + token. ----
  await page.goto('/signup');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  authEstablished = true;

  const projectCardHeading = page.getByRole('heading', { name: 'Default', level: 2 });
  await expect(projectCardHeading).toBeVisible();
  await projectCardHeading.click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);

  // ---- Step 2: read the real ingest token from the detail page's <code> block (as data-flow.func.spec.ts does). ----
  const tokenCode = page.locator('code').first();
  await expect(tokenCode).toBeVisible();
  const ingestToken = (await tokenCode.innerText()).trim();
  expect(ingestToken).toMatch(/^mam_[0-9a-f]{32}$/);

  // ---- Step 3: ingest a KNOWN, deterministic dataset directly against the real backend. ----
  // 2 distinct users (one session each) so total-vs-per-user counts are independently checkable,
  // and so the users/sessions/live views all have known, exact numbers to assert against.
  const userAlpha = 'user_alpha';
  const userBeta = 'user_beta';
  const sessionAlpha = randomUUID();
  const sessionBeta = randomUUID();

  const events: FakeEvent[] = [
    // product_viewed: 6 total — 4 ios (userAlpha), 2 android (userBeta). Drives the Insights
    // total-count assertion (6) and the `os` breakdown assertion (ios=4, android=2).
    ...Array.from({ length: 4 }, () =>
      makeEvent('product_viewed', userAlpha, sessionAlpha, 'ios'),
    ),
    ...Array.from({ length: 2 }, () =>
      makeEvent('product_viewed', userBeta, sessionBeta, 'android'),
    ),
    // checkout_completed: 3 total — 2 userAlpha, 1 userBeta. Shows up in the live feed.
    ...Array.from({ length: 2 }, () =>
      makeEvent('checkout_completed', userAlpha, sessionAlpha, 'ios'),
    ),
    makeEvent('checkout_completed', userBeta, sessionBeta, 'android'),
    // $session_end: 2 total, one per user/session, each a 4000ms session — drives the sessions
    // page's exact "2 sessions" / "4s avg duration" assertions.
    makeEvent('$session_end', userAlpha, sessionAlpha, 'ios', { $duration_ms: 4000 }),
    makeEvent('$session_end', userBeta, sessionBeta, 'android', { $duration_ms: 4000 }),
  ];
  expect(events).toHaveLength(11);
  // userAlpha: 4 product_viewed + 2 checkout_completed + 1 $session_end = 7 events.
  // userBeta:  2 product_viewed + 1 checkout_completed + 1 $session_end = 4 events.

  const ingestResponse = await request.post(INGEST_EVENTS_URL, {
    headers: { Authorization: `Bearer ${ingestToken}` },
    data: { events },
  });
  expect(ingestResponse.status()).toBe(202);
  expect(await ingestResponse.json()).toEqual({ accepted: 11, rejected: [] });

  // A profile `set` op for userAlpha, so their user profile page has a populated property.
  const profileResponse = await request.post(INGEST_PROFILES_URL, {
    headers: { Authorization: `Bearer ${ingestToken}` },
    data: {
      operations: [
        { distinct_id: userAlpha, op: 'set', properties: { plan: 'pro' }, timestamp: Date.now() },
      ],
    },
  });
  expect(profileResponse.status()).toBe(202);
  expect(await profileResponse.json()).toEqual({ accepted: 1, rejected: [] });

  // Sanity gate before diving into the analytics-specific pages: the plain event summary (contracts
  // §12, already covered in depth by data-flow.func.spec.ts) should already reflect all 11 events —
  // ClickHouse's async_insert with wait_for_async_insert=1 means the 202 above already implies
  // durable, immediately-queryable data (no sleep needed).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Total events' })).toBeVisible();
  await expect(page.locator('p.text-3xl')).toHaveText('11');

  const today = new Date().toISOString().slice(0, 10);

  // ---- Step 4: INSIGHTS — total count, then an exact `os` breakdown. ----
  await page.getByRole('link', { name: 'Insights' }).click();
  await expect(page).toHaveURL(/\/insights$/);
  await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();

  await page.getByLabel('Add an event').fill('product_viewed');
  await page.getByRole('button', { name: 'Add event' }).click();
  // The per-event aggregation <select> only renders once the event is in the builder's list —
  // its sr-only label is scoped to this one event, unlike a plain getByText (which would also
  // match the same string inside the <datalist> autocomplete options once /meta/events resolves).
  await expect(page.getByLabel('Aggregation for product_viewed')).toBeVisible();

  // Narrow the range to just today — the default is a 30-day window, and the raw-data table shows
  // one row per zero-filled bucket, so a wide range would bury the single day with real data.
  await page.getByLabel('From').fill(today);
  await page.getByLabel('To').fill(today);
  // Interval is already "day" by default (matches the contracts §14 default builder state).

  await page.getByRole('button', { name: 'Run' }).click();

  const insightsTable = page.getByRole('table', { name: 'Insights data table' });
  await expect(insightsTable).toBeVisible();

  // Switch to the Table view per the journey brief — note the raw-data table is actually ALWAYS
  // rendered below the chart regardless of this toggle (see InsightsChart.tsx), so this exercises
  // the real control without changing what's asserted.
  await page.getByRole('radio', { name: 'Table' }).click();
  await expect(page.getByRole('radio', { name: 'Table' })).toHaveAttribute('aria-checked', 'true');

  // No breakdown yet: exactly one row — product_viewed / today / 6 (exact total count).
  await expect(insightsTable.locator('tbody tr')).toHaveCount(1);
  await expect(insightsTable.locator('tbody tr')).toHaveText([
    new RegExp(`^product_viewed${today}6$`),
  ]);

  // Add the `os` breakdown and re-run — exact ios=4 / android=2 split.
  const breakdownSelect = page.getByLabel('Breakdown (optional)');
  // "os" is a fixed whitelisted event column (backend/src/analytics/property-resolver.ts), always
  // present in GET /meta/properties once it resolves — wait for the option before selecting it.
  await expect(breakdownSelect.locator('option[value="os"]')).toHaveCount(1);
  await breakdownSelect.selectOption('os');
  await page.getByRole('button', { name: 'Run' }).click();

  await expect(insightsTable.locator('tbody tr')).toHaveCount(2);
  const iosRow = insightsTable.locator('tbody tr', { hasText: 'ios' });
  const androidRow = insightsTable.locator('tbody tr', { hasText: 'android' });
  await expect(iosRow).toHaveText(new RegExp(`^product_viewedios${today}4$`));
  await expect(androidRow).toHaveText(new RegExp(`^product_viewedandroid${today}2$`));

  // ---- Step 5: LIVE — the freshly ingested events show up in the real-time feed. ----
  await page.getByRole('link', { name: 'Live' }).click();
  await expect(page).toHaveURL(/\/live$/);
  const liveTable = page.getByRole('table', { name: 'Live events, newest first' });
  await expect(liveTable).toBeVisible();
  await expect(
    liveTable.locator('tbody tr', { hasText: 'checkout_completed' }).first(),
  ).toBeVisible();
  await expect(
    liveTable.locator('tbody tr', { hasText: 'product_viewed' }).first(),
  ).toBeVisible();
  // All 11 ingested events fit on one page (page size 25) — exact total row count.
  await expect(liveTable.locator('tbody tr')).toHaveCount(11);

  // ---- Step 6: USERS — both distinct users listed, with exact per-user event counts. ----
  await page.getByRole('link', { name: 'Users' }).click();
  await expect(page).toHaveURL(/\/users$/);
  const usersTable = page.getByRole('table', { name: 'Users' });
  await expect(usersTable).toBeVisible();
  await expect(usersTable.locator('tbody tr')).toHaveCount(2);

  const alphaRow = usersTable.locator('tbody tr', { hasText: userAlpha });
  const betaRow = usersTable.locator('tbody tr', { hasText: userBeta });
  await expect(alphaRow.locator('td').last()).toHaveText('7');
  await expect(betaRow.locator('td').last()).toHaveText('4');

  await usersTable.getByRole('link', { name: userAlpha }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${userAlpha}$`));
  await expect(page.getByRole('heading', { name: userAlpha })).toBeVisible();

  // The set profile property (from the /ingest/profiles `set` op above).
  await expect(page.locator('dt', { hasText: 'plan' })).toBeVisible();
  await expect(page.locator('dd', { hasText: 'pro' })).toBeVisible();

  // Event count stat card — exact. Card is a plain styled <div>; scope by its heading since
  // several stat cards share the same "text-lg font-semibold" value styling on this page.
  const eventCountCard = page.locator('div.rounded-lg', {
    has: page.getByRole('heading', { name: 'Event count', level: 2 }),
  });
  await expect(eventCountCard.locator('p')).toHaveText('7');

  // Recent-activity timeline — exact per-event counts (all 7 of userAlpha's events fit in the
  // last-50 recent_events window).
  const recentActivityCard = page.locator('div.rounded-lg', {
    has: page.getByRole('heading', { name: 'Recent activity', level: 2 }),
  });
  const timeline = recentActivityCard.locator('ol > li');
  await expect(timeline).toHaveCount(7);
  await expect(timeline.filter({ hasText: 'product_viewed' })).toHaveCount(4);
  await expect(timeline.filter({ hasText: 'checkout_completed' })).toHaveCount(2);
  await expect(timeline.filter({ hasText: '$session_end' })).toHaveCount(1);

  // ---- Step 7: SESSIONS — exact session count and avg duration. ----
  await page.getByRole('link', { name: 'Sessions' }).click();
  await expect(page).toHaveURL(/\/sessions$/);

  const totalSessionsCard = page.locator('div.rounded-lg', {
    has: page.getByRole('heading', { name: 'Total sessions', level: 2 }),
  });
  await expect(totalSessionsCard.locator('p')).toHaveText('2');

  const avgDurationCard = page.locator('div.rounded-lg', {
    has: page.getByRole('heading', { name: 'Avg duration', level: 2 }),
  });
  // formatDurationMs(4000) -> "4s" (dashboard/src/features/analytics/format.ts).
  await expect(avgDurationCard.locator('p')).toHaveText('4s');

  // ---- Final: no console errors, no uncaught page errors, for the entire journey. ----
  expect(errors, `Unexpected console/page errors:\n${errors.join('\n')}`).toEqual([]);
});
