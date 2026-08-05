import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';
import type { RcCustomerRow } from '../customers-api';

const PID = TEST_PROJECT.id;
const CUSTOMERS_URL = `/projects/${PID}/rc/customers`;
const base = `/api/v1/projects/${PID}/customers`;

const ALICE: RcCustomerRow = {
  id: 'cust-alice',
  appUserId: 'alice-app-user',
  createdAt: '2026-01-05T12:00:00.000Z',
  lastSeenAt: '2026-07-10T12:00:00.000Z',
  activeSubscriptionCount: 1,
  totalSpentCents: 2999,
  currency: 'USD',
};
const BOB: RcCustomerRow = {
  id: 'cust-bob',
  appUserId: 'bob-app-user',
  createdAt: '2026-02-01T12:00:00.000Z',
  lastSeenAt: '2026-06-15T12:00:00.000Z',
  activeSubscriptionCount: 0,
  totalSpentCents: 0,
  currency: null,
};
const CAROL: RcCustomerRow = {
  id: 'cust-carol',
  appUserId: 'carol-app-user',
  createdAt: '2026-03-11T12:00:00.000Z',
  lastSeenAt: '2026-07-01T12:00:00.000Z',
  activeSubscriptionCount: 2,
  totalSpentCents: 15998,
  currency: 'USD',
};

/**
 * Registers a stateful in-memory mock of the `customers` list endpoint (design §1.3/§7) — this
 * sub-project's first dashboard consumer, so there's no shared fixture yet. Paginates 2 rows per
 * page (independent of whatever `limit` the real hook requests) so "load more" is exercisable
 * with just 3 seed rows, and filters `search` against `appUserId` exactly like the real endpoint's
 * case-insensitive contains — proving the filter happens via the request, not client-side.
 */
function mockCustomers(rows: RcCustomerRow[]) {
  const PAGE_SIZE = 2;
  server.use(
    http.get(base, ({ request }) => {
      const url = new URL(request.url);
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const cursor = url.searchParams.get('cursor');
      const filtered = search
        ? rows.filter((row) => row.appUserId.toLowerCase().includes(search))
        : rows;
      const startIndex = cursor ? filtered.findIndex((row) => row.id === cursor) + 1 : 0;
      const page = filtered.slice(startIndex, startIndex + PAGE_SIZE);
      const nextIndex = startIndex + PAGE_SIZE;
      const nextCursor = nextIndex < filtered.length ? (page[page.length - 1]?.id ?? null) : null;
      return HttpResponse.json({ items: page, nextCursor });
    }),
  );
}

function signInOwner() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('RcCustomersPage', () => {
  it('renders the first page of customers with formatted dates, active subs, and spend', async () => {
    signInOwner();
    mockCustomers([ALICE, BOB, CAROL]);
    renderApp(CUSTOMERS_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('alice-app-user')).toBeInTheDocument();
    expect(main.getByText('bob-app-user')).toBeInTheDocument();
    expect(main.queryByText('carol-app-user')).not.toBeInTheDocument(); // page 2, not loaded yet

    const aliceRow = main.getByText('alice-app-user').closest('tr') as HTMLElement;
    expect(within(aliceRow).getByText('Jan 5, 2026')).toBeInTheDocument(); // first seen
    expect(within(aliceRow).getByText('Jul 10, 2026')).toBeInTheDocument(); // last seen
    expect(within(aliceRow).getByText('1')).toBeInTheDocument(); // active subs
    expect(within(aliceRow).getByText('$29.99')).toBeInTheDocument(); // spend

    const bobRow = main.getByText('bob-app-user').closest('tr') as HTMLElement;
    expect(within(bobRow).getByText('—')).toBeInTheDocument(); // no spend yet

    expect(main.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('filters via the request when searching', async () => {
    signInOwner();
    mockCustomers([ALICE, BOB, CAROL]);
    renderApp(CUSTOMERS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('alice-app-user');

    await userEvent.type(main.getByLabelText('Search by app user ID'), 'carol');

    // "carol" is the 3rd seed row (page 2 under the default order), so it only appears once the
    // debounced request actually re-fires with `search=carol` — proving the filter is server-side.
    expect(await main.findByText('carol-app-user')).toBeInTheDocument();
    expect(main.queryByText('alice-app-user')).not.toBeInTheDocument();
    expect(main.queryByText('bob-app-user')).not.toBeInTheDocument();
  });

  it('fetches page 2 via Load more', async () => {
    signInOwner();
    mockCustomers([ALICE, BOB, CAROL]);
    renderApp(CUSTOMERS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('alice-app-user');

    await userEvent.click(main.getByRole('button', { name: 'Load more' }));

    expect(await main.findByText('carol-app-user')).toBeInTheDocument();
    await waitFor(() =>
      expect(main.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument(),
    );
  });

  it('shows an empty state when the project has no customers', async () => {
    signInOwner();
    mockCustomers([]);
    renderApp(CUSTOMERS_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('No customers yet')).toBeInTheDocument();
    expect(
      main.getByText('They appear here after their first purchase/SDK call.'),
    ).toBeInTheDocument();
  });

  it('navigates to the customer detail route on row click', async () => {
    signInOwner();
    mockCustomers([ALICE, BOB, CAROL]);
    const { router } = renderApp(CUSTOMERS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('alice-app-user');

    await userEvent.click(main.getByText('alice-app-user'));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/projects/${PID}/rc/customers/${ALICE.id}`),
    );
  });
});
