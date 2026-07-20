import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/empty-state';
import { useToast } from '../../../components/ui/toast';
import { useProjectRole, useProjects } from '../../projects/api';
import { useRcOfferings, useRcProducts, useSetCurrentOffering, type RcOffering, type RcPackage } from '../catalog-api';
import {
  apiErrorMessage,
  DeleteOfferingAlertDialog,
  OfferingFormDialog,
  PackageFormDialog,
  RemovePackageAlertDialog,
  resolveProductLabel,
} from './RcOfferingsPage.dialogs';

/**
 * MyRevenueCat → Offerings (design §3.3). Master-detail: the offerings `DataTable` up top
 * (identifier, displayName, current badge, package count), and a single packages panel below for
 * whichever offering is selected — defaulting to the current offering, then the first one, so the
 * detail pane is never empty on load. "View packages" is available to every role (it's a read, not
 * a mutation); New/Set current/Edit/Delete and the package Add/Edit/Remove controls are admin-only.
 * Mirrors `RcEntitlementsPage.tsx`/`RcProductsPage.tsx`'s gating discipline (don't decide "not
 * connected" until `useProjects()` has resolved) and `ProjectMembersSection`'s `DataTable` +
 * controlled-dialog CRUD pattern.
 */
export function RcOfferingsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/offerings' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);

  // Don't mount the catalog hooks below until `useProjects()` has resolved, or a still-loading
  // flag briefly flashes an empty shell.
  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Offerings"
        description="The product bundles presented to users, and how each one converts."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Offerings' }]}
      >
        {null}
      </PageShell>
    );
  }

  return <OfferingsManager projectId={projectId} />;
}

function OfferingsManager({ projectId }: { projectId: string }) {
  const role = useProjectRole(projectId);
  const canManage = role === 'admin' || role === 'owner';
  const { toast } = useToast();

  const offeringsQuery = useRcOfferings(projectId);
  const productsQuery = useRcProducts(projectId);
  const setCurrentOffering = useSetCurrentOffering(projectId);

  const [selectedOfferingId, setSelectedOfferingId] = useState<string | null>(null);
  const [showNewOffering, setShowNewOffering] = useState(false);
  const [editOffering, setEditOffering] = useState<RcOffering | null>(null);
  const [deleteOffering, setDeleteOffering] = useState<RcOffering | null>(null);
  const [showAddPackage, setShowAddPackage] = useState(false);
  const [editPackage, setEditPackage] = useState<RcPackage | null>(null);
  const [removePackageTarget, setRemovePackageTarget] = useState<RcPackage | null>(null);

  const offerings = offeringsQuery.data ?? [];
  const products = productsQuery.data ?? [];
  // Detail pane default: the current offering, falling back to the first one, so it's never empty.
  const activeOffering =
    offerings.find((o) => o.id === selectedOfferingId) ??
    offerings.find((o) => o.isCurrent) ??
    offerings[0] ??
    null;
  const activePackages = activeOffering
    ? [...activeOffering.packages].sort((a, b) => a.sortOrder - b.sortOrder || a.identifier.localeCompare(b.identifier))
    : [];

  const handleSetCurrent = (offering: RcOffering) => {
    setCurrentOffering.mutate(offering.id, {
      onError: (error) =>
        toast({
          title: 'Could not set current offering',
          description: apiErrorMessage(error, 'Something went wrong.'),
          variant: 'error',
        }),
    });
  };

  const offeringColumns: Array<DataTableColumn<RcOffering>> = [
    { key: 'identifier', header: 'Identifier', sortable: true },
    { key: 'displayName', header: 'Display name', sortable: true },
    {
      key: 'current',
      header: 'Current',
      render: (offering) => (offering.isCurrent ? <Badge variant="accent">Current</Badge> : null),
    },
    {
      key: 'packageCount',
      header: 'Packages',
      align: 'right',
      sortValue: (offering) => offering.packages.length,
      render: (offering) => offering.packages.length,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (offering) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setSelectedOfferingId(offering.id)}>
            View packages
          </Button>
          {canManage && !offering.isCurrent && (
            <Button
              variant="secondary"
              size="sm"
              disabled={setCurrentOffering.isPending}
              onClick={() => handleSetCurrent(offering)}
            >
              Set current
            </Button>
          )}
          {canManage && (
            <Button variant="secondary" size="sm" onClick={() => setEditOffering(offering)}>
              Edit
            </Button>
          )}
          {canManage && (
            <Button variant="danger" size="sm" onClick={() => setDeleteOffering(offering)}>
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const packageColumns: Array<DataTableColumn<RcPackage>> = [
    { key: 'identifier', header: 'Identifier', sortable: true },
    { key: 'packageType', header: 'Type', render: (pkg) => <Badge variant="outline">{pkg.packageType}</Badge> },
    { key: 'product', header: 'Product', render: (pkg) => resolveProductLabel(products, pkg.productId) },
    { key: 'sortOrder', header: 'Sort order', align: 'right' },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (pkg: RcPackage) => (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditPackage(pkg)}>
                  Edit
                </Button>
                <Button variant="danger" size="sm" onClick={() => setRemovePackageTarget(pkg)}>
                  Remove
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  const newOfferingButton = <Button onClick={() => setShowNewOffering(true)}>New offering</Button>;
  const addPackageButton = (
    <Button size="sm" onClick={() => setShowAddPackage(true)}>
      Add package
    </Button>
  );

  return (
    <PageShell
      projectId={projectId}
      title="Offerings"
      description="The product bundles presented to users, and how each one converts."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Offerings' }]}
      actions={canManage ? newOfferingButton : undefined}
    >
      {offeringsQuery.isPending && <p role="status">Loading offerings…</p>}
      {offeringsQuery.isError && (
        <p role="alert" className="text-danger">
          {apiErrorMessage(offeringsQuery.error, 'Could not load offerings.')}
        </p>
      )}

      {!offeringsQuery.isPending && !offeringsQuery.isError && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Offerings</CardTitle>
              <CardDescription>Group packages into a paywall bundle; exactly one offering is current.</CardDescription>
            </CardHeader>
            <CardContent>
              {offerings.length > 0 ? (
                <DataTable caption="RevenueCat offerings" columns={offeringColumns} rows={offerings} rowKey={(o) => o.id} />
              ) : (
                <EmptyState
                  title="No offerings yet."
                  description={
                    canManage
                      ? 'Create an offering to start bundling packages for your paywall.'
                      : 'No offerings have been created for this project yet.'
                  }
                  action={canManage ? newOfferingButton : undefined}
                />
              )}
            </CardContent>
          </Card>

          {activeOffering && (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Packages — {activeOffering.identifier}</CardTitle>
                  <CardDescription>{activeOffering.displayName}</CardDescription>
                </div>
                {canManage && addPackageButton}
              </CardHeader>
              <CardContent>
                {activePackages.length > 0 ? (
                  <DataTable
                    caption={`Packages in ${activeOffering.identifier}`}
                    columns={packageColumns}
                    rows={activePackages}
                    rowKey={(p) => p.id}
                  />
                ) : (
                  <EmptyState
                    title="No packages in this offering"
                    description={
                      canManage
                        ? 'Add a package to attach a product to this offering’s paywall.'
                        : 'No packages have been added to this offering yet.'
                    }
                    action={canManage ? addPackageButton : undefined}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {canManage && <OfferingFormDialog projectId={projectId} open={showNewOffering} onOpenChange={setShowNewOffering} />}
      {canManage && editOffering && (
        <OfferingFormDialog
          projectId={projectId}
          offering={editOffering}
          open
          onOpenChange={(open) => !open && setEditOffering(null)}
        />
      )}
      {canManage && deleteOffering && (
        <DeleteOfferingAlertDialog projectId={projectId} offering={deleteOffering} onClose={() => setDeleteOffering(null)} />
      )}

      {canManage && activeOffering && (
        <PackageFormDialog
          projectId={projectId}
          offeringId={activeOffering.id}
          products={products}
          open={showAddPackage}
          onOpenChange={setShowAddPackage}
        />
      )}
      {canManage && activeOffering && editPackage && (
        <PackageFormDialog
          projectId={projectId}
          offeringId={activeOffering.id}
          pkg={editPackage}
          products={products}
          open
          onOpenChange={(open) => !open && setEditPackage(null)}
        />
      )}
      {canManage && activeOffering && removePackageTarget && (
        <RemovePackageAlertDialog
          projectId={projectId}
          offeringId={activeOffering.id}
          pkg={removePackageTarget}
          onClose={() => setRemovePackageTarget(null)}
        />
      )}
    </PageShell>
  );
}
