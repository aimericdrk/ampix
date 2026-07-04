import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

/**
 * Functional, end-to-end, NO-MOCK test: drives the real dashboard UI against the
 * real backend (NestJS + Postgres + ClickHouse + Redis, all started by
 * scripts/functional-test.sh) exactly as a human user and a mobile SDK would.
 *
 * Journey: sign up through the UI → log out → log back in through the UI →
 * navigate to the auto-provisioned "Default" project → read the ingest token
 * shown in the UI → send fake mobile analytics events straight to
 * POST /ingest/events using that token → reload the dashboard and assert the
 * event counts shown are EXACTLY correct (proves the real ClickHouse round trip,
 * not a mock).
 *
 * Contracts: docs/superpowers/specs/2026-07-02-shared-contracts.md §4 (ingest),
 * §11 (auth), §12 (projects + events/summary).
 */

const INGEST_URL = 'http://localhost:8080/ingest/events';

/** Mobile device/app context shared by every fake event (contracts §4). */
const MOBILE_CONTEXT = {
  os: 'android',
  os_version: '14',
  app_version: '1.0.0',
  device_model: 'Pixel 8',
  device_manufacturer: 'Google',
  locale: 'en_US',
  network: 'wifi',
  sdk_version: '0.1.0',
};

interface FakeEvent {
  insert_id: string;
  event: string;
  distinct_id: string;
  anon_id: string;
  session_id: string;
  timestamp: number;
  properties?: Record<string, unknown>;
  context: typeof MOBILE_CONTEXT;
}

function makeEvent(
  sessionId: string,
  event: string,
  properties?: Record<string, unknown>,
): FakeEvent {
  return {
    insert_id: randomUUID(),
    event,
    distinct_id: 'u_ada',
    anon_id: 'a_ada',
    session_id: sessionId,
    timestamp: Date.now(),
    ...(properties ? { properties } : {}),
    context: MOBILE_CONTEXT,
  };
}

test('real user journey: signup, login, ingest fake mobile data, dashboard shows correct counts', async ({
  page,
  request,
}) => {
  // Capture every console error and uncaught page error for the whole test —
  // asserted empty at the very end. Registered before any navigation.
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  // Flips true once the first sign-up succeeds — see the filter comment below.
  let authEstablished = false;

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (text.includes('favicon.ico')) return; // unavoidable dev-server noise, not app-related
    // Every fresh page load silently probes for an existing session via
    // POST /api/v1/auth/refresh (router.tsx's ensureAuthResolved -> client.ts's
    // restoreSession). Before the first signup/login there is no refresh cookie
    // yet, so Chromium logs that expected 401 as a "failed resource load" —
    // harmless, not an app bug. Once authenticated, any further 401 is real and
    // must still fail the test, so this only suppresses the pre-auth case.
    if (!authEstablished && text.includes('401')) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  const email = `func_${Date.now()}@example.com`;
  const password = 'correct-horse-battery-9';
  const name = 'Ada Lovelace';

  // ---- Step 1: sign up through the UI. Auto-provisions org + Default project + token. ----
  await page.goto('/signup');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  authEstablished = true;

  // ---- Step 2: log out, then log back in through the UI with the same credentials. ----
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // ---- Step 3: navigate organizations/projects. ----
  // ProjectsPage renders the project card (name + timezone) but not the org name
  // (see dashboard/src/features/projects/components/ProjectsPage.tsx) — org name is
  // shown on the detail page, so it is asserted there, right after navigating in.
  const projectCardHeading = page.getByRole('heading', { name: 'Default', level: 2 });
  await expect(projectCardHeading).toBeVisible();
  await projectCardHeading.click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Default', level: 1 })).toBeVisible();
  // Scoped to #main-content: the tenancy UI's sidebar <OrgSwitcher> also renders an
  // <option> with this same org name, so an unscoped getByText matches both.
  await expect(
    page.locator('#main-content').getByText("Ada Lovelace's Workspace", { exact: true }),
  ).toBeVisible();

  // ---- Step 4: read the real ingest token from the detail page's <code> block. ----
  // .first(): the tenancy UI's admin-only Settings/Tokens table below also renders the
  // same token in its own <code> cell, but the "Ingest token" card is first in DOM order.
  const tokenCode = page.locator('code').first();
  await expect(tokenCode).toBeVisible();
  const ingestToken = (await tokenCode.innerText()).trim();
  expect(ingestToken).toMatch(/^mam_[0-9a-f]{32}$/);

  await expect(page.getByRole('heading', { name: 'Total events' })).toBeVisible();
  await expect(page.locator('p.text-3xl')).toHaveText('0');
  await expect(page.getByText(/No events yet/)).toBeVisible();

  // ---- Step 5: ingest fake mobile analytics data directly against the real backend. ----
  const sessionId = randomUUID();
  const events: FakeEvent[] = [
    ...Array.from({ length: 5 }, () => makeEvent(sessionId, 'app_open')),
    ...Array.from({ length: 3 }, () => makeEvent(sessionId, 'product_viewed')),
    ...Array.from({ length: 2 }, () => makeEvent(sessionId, 'checkout_completed', { value: 9.99 })),
  ];

  const ingestResponse = await request.post(INGEST_URL, {
    headers: { Authorization: `Bearer ${ingestToken}` },
    data: { events },
  });

  expect(ingestResponse.status()).toBe(202);
  expect(await ingestResponse.json()).toEqual({ accepted: 10, rejected: [] });

  // ---- Step 6: reload (full refetch) and assert the dashboard shows CORRECT data. ----
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Total events' })).toBeVisible();
  await expect(page.locator('p.text-3xl')).toHaveText('10');

  // Named: the tenancy UI's admin-only Settings/Tokens table below is also a <table>.
  const table = page.getByRole('table', { name: 'Events by name' });
  await expect(table).toBeVisible();

  // Exact per-event counts, each row selected by its event name.
  const expectedCounts: Array<[event: string, count: number]> = [
    ['app_open', 5],
    ['product_viewed', 3],
    ['checkout_completed', 2],
  ];
  for (const [eventName, count] of expectedCounts) {
    const row = table.locator('tbody tr', { hasText: eventName });
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').last()).toHaveText(String(count));
  }

  // Ordering is count-desc: app_open (5) before product_viewed (3) before
  // checkout_completed (2). A single positional toHaveText assertion checks row
  // count, per-row text, AND order together, with Playwright's normal auto-retry.
  // (The two <td> cells are adjacent with no separating whitespace, hence no \s+.)
  await expect(table.locator('tbody tr')).toHaveText([
    /^app_open5$/,
    /^product_viewed3$/,
    /^checkout_completed2$/,
  ]);

  // ---- Final: no console errors, no uncaught page errors, for the entire journey. ----
  expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `Unexpected page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
