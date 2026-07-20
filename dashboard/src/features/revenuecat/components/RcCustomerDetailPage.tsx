import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/empty-state';
import { formatCurrency } from '../../analytics/format';
import { useProjectRole, useProjects } from '../../projects/api';
import { useRcEntitlements } from '../catalog-api';
import {
  useRcCustomer,
  type RcEntitlementInfo,
  type RcPromotionalEntitlement,
  type RcSubscriptionRow,
  type RcTransactionRow,
} from '../customers-api';
import {
  apiErrorMessage,
  DeleteCustomerAlertDialog,
  GrantEntitlementDialog,
  RevokeGrantAlertDialog,
} from './RcCustomerDetailPage.dialogs';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** `null` means "never expires" (design §1.1's lifetime grant, or a promotionally-unioned
 *  entitlement's expiry per §1.2) — distinct from the `—` used for other absent optional fields. */
function formatExpiry(iso: string | null): string {
  return iso === null ? 'Never expires' : formatDate(iso);
}

/** A `CustomerInfo` entitlement is promotionally-sourced when the engine's union (design §1.2)
 *  marked it `store: 'promotional'`. */
function isPromotional(entitlement: RcEntitlementInfo): boolean {
  return entitlement.store === 'promotional';
}

/**
 * MyRevenueCat → Customer detail (design `2026-07-20-myrevenuecat-customers-design.md` §2). The
 * nested `/rc/customers/$customerId` route: computed `CustomerInfo` entitlements (active/expired,
 * flagging promotionally-sourced ones), the raw subscriptions/transactions tables, attributes, and
 * the three admin-only mutations — grant/revoke a promotional entitlement, delete the customer.
 * Design §0: NO connect gate; the only gate is `useProjects()` resolving (mirrors
 * `RcOfferingsPage`'s gate-then-mount). Writes are gated on `useProjectRole ∈ {admin, owner}`; a
 * viewer sees the same sections fully read-only.
 */
export function RcCustomerDetailPage() {
  const { projectId, customerId } = useParams({
    from: '/private/projects/$projectId/rc/customers/$customerId',
  });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);

  // Don't mount the customer-detail hooks below until `useProjects()` has resolved, or a
  // still-loading flag briefly flashes an empty shell (same discipline as `RcOfferingsPage`).
  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Customer"
        description="Entitlements, subscriptions, and purchase history for this customer."
        breadcrumbs={[
          { label: 'MyRevenueCat' },
          { label: 'Customers', to: '/projects/$projectId/rc/customers', params: { projectId } },
        ]}
      >
        {null}
      </PageShell>
    );
  }

  return <CustomerDetailManager projectId={projectId} customerId={customerId} />;
}

function CustomerDetailManager({ projectId, customerId }: { projectId: string; customerId: string }) {
  const role = useProjectRole(projectId);
  const canManage = role === 'admin' || role === 'owner';

  const detailQuery = useRcCustomer(projectId, customerId);
  const entitlementsQuery = useRcEntitlements(projectId);

  const [showGrant, setShowGrant] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<RcPromotionalEntitlement | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  const catalogEntitlements = entitlementsQuery.data ?? [];
  const customer = detailQuery.data?.customer;
  const customerInfo = detailQuery.data?.customerInfo;
  const subscriptions = detailQuery.data?.subscriptions ?? [];
  const transactions = detailQuery.data?.transactions ?? [];
  const promotionalGrants = detailQuery.data?.promotionalEntitlements ?? [];
  const attributeEntries = Object.entries(customer?.attributes ?? {});
  const entitlementRows = customerInfo
    ? Object.entries(customerInfo.entitlements.all).map(([identifier, info]) => ({ identifier, info }))
    : [];

  const entitlementColumns: Array<DataTableColumn<{ identifier: string; info: RcEntitlementInfo }>> = [
    { key: 'identifier', header: 'Entitlement', sortable: true },
    {
      key: 'status',
      header: 'Status',
      render: ({ info }) =>
        info.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="default">Expired</Badge>,
    },
    {
      key: 'source',
      header: 'Source',
      render: ({ info }) =>
        isPromotional(info) ? <Badge variant="accent">Promotional</Badge> : info.productIdentifier,
    },
    { key: 'expirationDate', header: 'Expires', render: ({ info }) => formatExpiry(info.expirationDate) },
  ];

  const grantColumns: Array<DataTableColumn<RcPromotionalEntitlement>> = [
    { key: 'entitlementIdentifier', header: 'Entitlement', sortable: true },
    { key: 'grantedAt', header: 'Granted', render: (grant) => formatDate(grant.grantedAt) },
    { key: 'expiresAt', header: 'Expires', render: (grant) => formatExpiry(grant.expiresAt) },
    { key: 'note', header: 'Note', render: (grant) => grant.note ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (grant) =>
        grant.revokedAt === null ? <Badge variant="success">Active</Badge> : <Badge variant="default">Revoked</Badge>,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (grant: RcPromotionalEntitlement) =>
              grant.revokedAt === null ? (
                <div className="flex justify-end">
                  <Button variant="danger" size="sm" onClick={() => setRevokeTarget(grant)}>
                    Revoke
                  </Button>
                </div>
              ) : null,
          },
        ]
      : []),
  ];

  const subscriptionColumns: Array<DataTableColumn<RcSubscriptionRow>> = [
    { key: 'store', header: 'Store' },
    { key: 'storeProductId', header: 'Product', sortable: true },
    { key: 'status', header: 'Status' },
    { key: 'autoRenewStatus', header: 'Auto-renew', render: (sub) => (sub.autoRenewStatus ? 'Yes' : 'No') },
    { key: 'purchasedAt', header: 'Purchased', render: (sub) => formatDate(sub.purchasedAt) },
    { key: 'expiresAt', header: 'Expires', render: (sub) => formatExpiry(sub.expiresAt) },
  ];

  const transactionColumns: Array<DataTableColumn<RcTransactionRow>> = [
    { key: 'store', header: 'Store' },
    { key: 'storeProductId', header: 'Product', sortable: true },
    { key: 'type', header: 'Type' },
    { key: 'purchasedAt', header: 'Purchased', render: (tx) => formatDate(tx.purchasedAt) },
    {
      key: 'priceCents',
      header: 'Price',
      align: 'right',
      render: (tx) => (tx.priceCents === null ? '—' : formatCurrency(tx.priceCents / 100, tx.currency ?? 'USD')),
    },
    {
      key: 'revokedAt',
      header: 'Status',
      render: (tx) => (tx.revokedAt === null ? 'Valid' : <Badge variant="danger">Revoked</Badge>),
    },
  ];

  const attributeColumns: Array<DataTableColumn<{ key: string; value: string }>> = [
    { key: 'key', header: 'Key', sortable: true },
    { key: 'value', header: 'Value' },
  ];

  const grantButton = (
    <Button size="sm" onClick={() => setShowGrant(true)}>
      Grant promotional entitlement
    </Button>
  );

  return (
    <PageShell
      projectId={projectId}
      // Static, not `customer.appUserId` — the breadcrumb's trailing crumb below is the one place
      // the app user id renders; duplicating it into the `<h1>` too gives two DOM nodes with the
      // exact same text (`ReportDetailPage.tsx`/`DashboardViewPage.tsx` do this too, untested).
      title="Customer"
      description="Entitlements, subscriptions, and purchase history for this customer."
      breadcrumbs={[
        { label: 'MyRevenueCat' },
        { label: 'Customers', to: '/projects/$projectId/rc/customers', params: { projectId } },
        { label: customer?.appUserId ?? customerId },
      ]}
      actions={
        canManage ? (
          <Button variant="danger" onClick={() => setShowDelete(true)}>
            Delete customer
          </Button>
        ) : undefined
      }
    >
      {detailQuery.isPending && <p role="status">Loading customer…</p>}
      {detailQuery.isError && (
        <p role="alert" className="text-danger">
          {apiErrorMessage(detailQuery.error, 'Could not load this customer.')}
        </p>
      )}

      {!detailQuery.isPending && !detailQuery.isError && customerInfo && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Entitlements</CardTitle>
              <CardDescription>Every entitlement this customer has ever held, active or not.</CardDescription>
            </CardHeader>
            <CardContent>
              {entitlementRows.length > 0 ? (
                <DataTable
                  caption="Customer entitlements"
                  columns={entitlementColumns}
                  rows={entitlementRows}
                  rowKey={(row) => row.identifier}
                />
              ) : (
                <EmptyState title="No entitlements yet" description="This customer has never held an entitlement." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Promotional entitlements</CardTitle>
                <CardDescription>Grants made directly from this dashboard, independent of the stores.</CardDescription>
              </div>
              {canManage && grantButton}
            </CardHeader>
            <CardContent>
              {promotionalGrants.length > 0 ? (
                <DataTable
                  caption="Promotional entitlement grants"
                  columns={grantColumns}
                  rows={promotionalGrants}
                  rowKey={(grant) => grant.id}
                />
              ) : (
                <EmptyState
                  title="No promotional grants"
                  description={
                    canManage
                      ? 'Grant a promotional entitlement to comp this customer access.'
                      : 'No promotional entitlements have been granted to this customer.'
                  }
                  action={canManage ? grantButton : undefined}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Subscriptions</CardTitle>
              <CardDescription>
                Every store subscription this customer has, whether or not it’s currently active.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {subscriptions.length > 0 ? (
                <DataTable
                  caption="Customer subscriptions"
                  columns={subscriptionColumns}
                  rows={subscriptions}
                  rowKey={(sub) => sub.id}
                />
              ) : (
                <EmptyState title="No subscriptions" description="This customer has no store subscriptions yet." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Transactions</CardTitle>
              <CardDescription>Purchase history, most recent first.</CardDescription>
            </CardHeader>
            <CardContent>
              {transactions.length > 0 ? (
                <DataTable
                  caption="Customer transactions"
                  columns={transactionColumns}
                  rows={transactions}
                  rowKey={(tx) => tx.id}
                />
              ) : (
                <EmptyState title="No transactions" description="This customer has no purchase history yet." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attributes</CardTitle>
              <CardDescription>Subscriber attributes recorded for this customer (read-only).</CardDescription>
            </CardHeader>
            <CardContent>
              {attributeEntries.length > 0 ? (
                <DataTable
                  caption="Customer attributes"
                  columns={attributeColumns}
                  rows={attributeEntries.map(([key, value]) => ({ key, value: String(value) }))}
                  rowKey={(row) => row.key}
                />
              ) : (
                <EmptyState
                  title="No attributes set"
                  description="No subscriber attributes have been recorded for this customer."
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {canManage && (
        <GrantEntitlementDialog
          projectId={projectId}
          customerId={customerId}
          entitlements={catalogEntitlements}
          open={showGrant}
          onOpenChange={setShowGrant}
        />
      )}

      {canManage && revokeTarget && (
        <RevokeGrantAlertDialog
          projectId={projectId}
          customerId={customerId}
          grant={revokeTarget}
          onClose={() => setRevokeTarget(null)}
        />
      )}

      {canManage && showDelete && (
        <DeleteCustomerAlertDialog
          projectId={projectId}
          customerId={customerId}
          onClose={() => setShowDelete(false)}
        />
      )}
    </PageShell>
  );
}
