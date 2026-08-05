import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/empty-state';
import { Input } from '../../../components/ui/input';
import { ApiError } from '../../../lib/api/problem';
import { formatCurrency } from '../../analytics/format';
import { useProjects } from '../../projects/api';
import { useRcCustomers, type RcCustomerRow } from '../customers-api';

const SEARCH_DEBOUNCE_MS = 250;

/** Settles `value` after `delayMs` of no changes — throttles the customer search request so every
 *  keystroke doesn't refetch. Duplicated locally (rather than imported) because its only existing
 *  instance lives in `CommandPalette.tsx`, collapse-rail WIP no other feature may touch. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

/**
 * MyRevenueCat → Customers (design 2026-07-20-myrevenuecat-customers-design.md §2). A searchable,
 * keyset-paginated subscriber list — app user id, first/last seen, active subscription count, and
 * lifetime spend — reading the billing-authority `mobile_purchase` service directly. Design §0: NO
 * connect gate; the only gate is `useProjects()` resolving (mirrors `RcOfferingsPage`'s
 * gate-then-mount so a still-loading project is never mistaken for a missing one). The page is
 * entirely read-only — every mutation (grant/revoke/delete) lives on the per-customer detail page
 * added in B6 — so there is no `useProjectRole` gating here beyond the row-click navigation to
 * that detail route.
 */
export function RcCustomersPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/customers' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);

  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Customers"
        description="Browse subscribers, their entitlements, and their purchase history."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Customers' }]}
      >
        {null}
      </PageShell>
    );
  }

  return <CustomersList projectId={projectId} />;
}

function CustomersList({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  const { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useRcCustomers(projectId, { search });

  const customers = data?.pages.flatMap((page) => page.items) ?? [];

  const goToCustomer = (customer: RcCustomerRow) => {
    void navigate({
      to: '/projects/$projectId/rc/customers/$customerId',
      params: { projectId, customerId: customer.id },
    });
  };

  const columns: Array<DataTableColumn<RcCustomerRow>> = [
    { key: 'appUserId', header: 'App user ID' },
    { key: 'createdAt', header: 'First seen', render: (row) => formatDate(row.createdAt) },
    { key: 'lastSeenAt', header: 'Last seen', render: (row) => formatDate(row.lastSeenAt) },
    { key: 'activeSubscriptionCount', header: 'Active subs', align: 'right' },
    {
      key: 'spend',
      header: 'Spend',
      align: 'right',
      render: (row) =>
        row.totalSpentCents > 0
          ? formatCurrency(row.totalSpentCents / 100, row.currency ?? 'USD')
          : '—',
    },
  ];

  return (
    <PageShell
      projectId={projectId}
      title="Customers"
      description="Browse subscribers, their entitlements, and their purchase history."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Customers' }]}
    >
      <div className="max-w-sm">
        <label htmlFor="customer-search" className="mb-1.5 block text-sm font-medium">
          Search by app user ID
        </label>
        <Input
          id="customer-search"
          placeholder="Search customers…"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
      </div>

      {isPending && <p role="status">Loading customers…</p>}
      {isError && (
        <p role="alert" className="text-danger">
          {apiErrorMessage(error, 'Could not load customers.')}
        </p>
      )}

      {!isPending && !isError && (
        <Card>
          <CardHeader>
            <CardTitle>Customers</CardTitle>
            <CardDescription>Every subscriber recorded for this project.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {customers.length > 0 ? (
              <>
                <DataTable
                  caption="Customers"
                  columns={columns}
                  rows={customers}
                  rowKey={(row) => row.id}
                  onRowClick={goToCustomer}
                />
                {hasNextPage && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="self-start"
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </Button>
                )}
              </>
            ) : (
              <EmptyState
                icon={Users}
                title="No customers yet"
                description="They appear here after their first purchase/SDK call."
              />
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
