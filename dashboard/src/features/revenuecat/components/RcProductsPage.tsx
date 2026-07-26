import { useState, type FormEvent } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Badge, type BadgeProps } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { EmptyState } from '../../../components/ui/empty-state';
import { fieldLook, Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Reveal } from '../../../components/ui/reveal';
import { ApiError } from '../../../lib/api/problem';
import { cn } from '../../../lib/cn';
import { formatCurrency } from '../../analytics/format';
import { useProjectRole, useProjects } from '../../projects/api';
import {
  useAttachEntitlement,
  useCreateRcApp,
  useCreateRcProduct,
  useDeleteRcApp,
  useDeleteRcProduct,
  useDetachEntitlement,
  useRcApps,
  useRcEntitlements,
  useRcProducts,
  useUpdateRcProduct,
  type RcApp,
  type RcAppPlatform,
  type RcEntitlement,
  type RcProduct,
  type RcProductType,
} from '../catalog-api';

/** Every `App.platform` value `createAppSchema` accepts (`backend/mobile_purchase/src/catalog/support/catalog.schemas.ts`). */
const APP_PLATFORMS: RcAppPlatform[] = ['IOS', 'ANDROID', 'MACOS', 'AMAZON', 'WEB'];

/** Every `Product.type` value `createProductSchema` accepts, same source. */
const PRODUCT_TYPES: RcProductType[] = [
  'AUTO_RENEWABLE_SUBSCRIPTION',
  'NON_RENEWING_SUBSCRIPTION',
  'CONSUMABLE',
  'NON_CONSUMABLE',
];

/** Human label for a `RcProductType` value — the raw enum reads fine in code but not in a picker. */
function productTypeLabel(type: RcProductType): string {
  switch (type) {
    case 'AUTO_RENEWABLE_SUBSCRIPTION':
      return 'Auto-renewable subscription';
    case 'NON_RENEWING_SUBSCRIPTION':
      return 'Non-renewing subscription';
    case 'CONSUMABLE':
      return 'Consumable';
    case 'NON_CONSUMABLE':
      return 'Non-consumable';
    default:
      return type;
  }
}

/** Subscriptions (renewing or not) get the accent badge; one-off purchases stay neutral. */
function productTypeBadgeVariant(type: RcProductType): BadgeProps['variant'] {
  return type === 'AUTO_RENEWABLE_SUBSCRIPTION' || type === 'NON_RENEWING_SUBSCRIPTION'
    ? 'accent'
    : 'default';
}

/** Renders an `ApiError`'s problem detail (falling back to its title) so a failed dialog submit
 *  shows the server's actual reason inline and keeps the dialog open (design §4); any other error
 *  keeps a generic fallback. Mirrors `RcEntitlementsPage.tsx`'s `apiErrorMessage`. */
function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

/**
 * MyRevenueCat → Products (design §3.2): pick an app, manage its store products, and link each
 * product to the entitlements it grants. Mirrors `RcEntitlementsPage.tsx`'s gating discipline
 * (don't decide "not connected" until `useProjects()` has resolved) and `ProjectMembersSection`'s
 * `DataTable` + controlled-dialog CRUD pattern.
 */
export function RcProductsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/products' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);

  // Don't mount the catalog hooks below until `useProjects()` has resolved, or a still-loading
  // flag briefly flashes an empty shell.
  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Products"
        description="The store products for this app, with their pricing and performance."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Products' }]}
      >
        {null}
      </PageShell>
    );
  }

  return <ProductsManager projectId={projectId} />;
}

function ProductsManager({ projectId }: { projectId: string }) {
  const role = useProjectRole(projectId);
  const canManage = role === 'admin' || role === 'owner';

  const apps = useRcApps(projectId);
  const products = useRcProducts(projectId);
  const entitlements = useRcEntitlements(projectId);

  const [selectedAppId, setSelectedAppId] = useState('');
  const [newAppOpen, setNewAppOpen] = useState(false);
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [deleteAppId, setDeleteAppId] = useState<string | null>(null);
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [manageEntitlementsProductId, setManageEntitlementsProductId] = useState<string | null>(null);
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);

  const appList = apps.data ?? [];
  const currentAppId =
    selectedAppId && appList.some((app) => app.id === selectedAppId)
      ? selectedAppId
      : (appList[0]?.id ?? '');
  const currentApp = appList.find((app) => app.id === currentAppId) ?? null;
  const allProducts = products.data ?? [];
  const appProducts = allProducts.filter((product) => product.appId === currentAppId);
  const entitlementList = entitlements.data ?? [];

  // Dialog targets are held as IDs, not the row object itself, and re-derived from
  // `apps.data`/`products.data` on every render — storing the row would freeze the dialog on the
  // stale snapshot captured when it opened. After an attach/detach mutation invalidates and
  // refetches the products list (no optimistic updates, design §4), the "Manage entitlements"
  // checkbox for the entitlement just toggled needs to flip to reflect the real server state.
  const deleteAppTarget = deleteAppId ? (appList.find((app) => app.id === deleteAppId) ?? null) : null;
  const editProductTarget = editProductId
    ? (allProducts.find((product) => product.id === editProductId) ?? null)
    : null;
  const manageEntitlementsTarget = manageEntitlementsProductId
    ? (allProducts.find((product) => product.id === manageEntitlementsProductId) ?? null)
    : null;
  const deleteProductTarget = deleteProductId
    ? (allProducts.find((product) => product.id === deleteProductId) ?? null)
    : null;

  return (
    <PageShell
      projectId={projectId}
      title="Products"
      description="The store products for this app, with their pricing and performance."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Products' }]}
      actions={
        canManage && currentApp ? (
          <Button onClick={() => setNewProductOpen(true)}>New product</Button>
        ) : undefined
      }
    >
      {apps.isPending && (
        <Reveal index={0}>
          <p role="status">Loading apps…</p>
        </Reveal>
      )}
      {apps.isError && (
        <Reveal index={0}>
          <p role="alert" className="text-danger">
            {apiErrorMessage(apps.error, 'Could not load apps.')}
          </p>
        </Reveal>
      )}

      {!apps.isPending && !apps.isError && appList.length === 0 && (
        <Reveal index={0}>
          <EmptyState
            title="No apps yet."
            description={
              canManage
                ? 'Add an app to start listing its products.'
                : 'Ask a project admin to add an app.'
            }
            action={canManage ? <Button onClick={() => setNewAppOpen(true)}>New app</Button> : undefined}
          />
        </Reveal>
      )}

      {appList.length > 0 && (
        <>
          <Reveal index={0}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="flex flex-col gap-1 text-sm text-text-muted">
                <span>App</span>
                <select
                  aria-label="App"
                  className={cn(fieldLook, 'h-9 w-64')}
                  value={currentAppId}
                  onChange={(event) => setSelectedAppId(event.target.value)}
                >
                  {appList.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name} ({app.platform})
                    </option>
                  ))}
                </select>
              </label>
              {canManage && (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setNewAppOpen(true)}>
                    New app
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={!currentApp}
                    onClick={() => currentApp && setDeleteAppId(currentApp.id)}
                  >
                    Delete app
                  </Button>
                </div>
              )}
            </div>
          </Reveal>

          <Reveal index={1}>
            {products.isPending ? (
              <p role="status">Loading products…</p>
            ) : products.isError ? (
              <p role="alert" className="text-danger">
                {apiErrorMessage(products.error, 'Could not load products.')}
              </p>
            ) : (
              <ProductsTable
                products={appProducts}
                canManage={canManage}
                onEdit={(product) => setEditProductId(product.id)}
                onManageEntitlements={(product) => setManageEntitlementsProductId(product.id)}
                onDelete={(product) => setDeleteProductId(product.id)}
              />
            )}
          </Reveal>
        </>
      )}

      {canManage && (
        <NewAppDialog
          projectId={projectId}
          open={newAppOpen}
          onOpenChange={setNewAppOpen}
          onCreated={setSelectedAppId}
        />
      )}
      {canManage && deleteAppTarget && (
        <DeleteAppAlertDialog
          projectId={projectId}
          app={deleteAppTarget}
          onClose={() => setDeleteAppId(null)}
        />
      )}
      {canManage && currentApp && (
        <NewProductDialog
          projectId={projectId}
          appId={currentApp.id}
          open={newProductOpen}
          onOpenChange={setNewProductOpen}
        />
      )}
      {canManage && editProductTarget && (
        <EditProductDialog
          projectId={projectId}
          product={editProductTarget}
          onClose={() => setEditProductId(null)}
        />
      )}
      {canManage && manageEntitlementsTarget && (
        <ManageEntitlementsDialog
          projectId={projectId}
          product={manageEntitlementsTarget}
          entitlements={entitlementList}
          onClose={() => setManageEntitlementsProductId(null)}
        />
      )}
      {canManage && deleteProductTarget && (
        <DeleteProductAlertDialog
          projectId={projectId}
          product={deleteProductTarget}
          onClose={() => setDeleteProductId(null)}
        />
      )}
    </PageShell>
  );
}

function ProductsTable({
  products,
  canManage,
  onEdit,
  onManageEntitlements,
  onDelete,
}: {
  products: RcProduct[];
  canManage: boolean;
  onEdit: (product: RcProduct) => void;
  onManageEntitlements: (product: RcProduct) => void;
  onDelete: (product: RcProduct) => void;
}) {
  if (products.length === 0) {
    return (
      <EmptyState title="No products yet." description="Products entered for this app will appear here." />
    );
  }

  const columns: Array<DataTableColumn<RcProduct>> = [
    { key: 'storeProductId', header: 'Store product ID', sortable: true },
    {
      key: 'type',
      header: 'Type',
      render: (product) => (
        <Badge variant={productTypeBadgeVariant(product.type)}>{productTypeLabel(product.type)}</Badge>
      ),
    },
    { key: 'displayName', header: 'Display name', sortable: true },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      sortValue: (product) => product.priceCents ?? -1,
      render: (product) =>
        product.priceCents != null && product.currency
          ? formatCurrency(product.priceCents / 100, product.currency)
          : '—',
    },
    {
      key: 'durationIso8601',
      header: 'Duration',
      render: (product) => product.durationIso8601 ?? '—',
    },
    {
      key: 'entitlements',
      header: 'Entitlements',
      render: (product) =>
        product.entitlements.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {product.entitlements.map((entitlement) => (
              <Badge key={entitlement.id} variant="info">
                {entitlement.identifier}
              </Badge>
            ))}
          </div>
        ) : (
          '—'
        ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (product: RcProduct) => (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => onEdit(product)}>
                  Edit
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onManageEntitlements(product)}>
                  Manage entitlements
                </Button>
                <Button variant="danger" size="sm" onClick={() => onDelete(product)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <DataTable
      caption="Products for the selected app"
      columns={columns}
      rows={products}
      rowKey={(product) => product.id}
      initialSort={{ key: 'storeProductId', dir: 'asc' }}
    />
  );
}

/** New app (design §3.2 header action): name, platform, and the platform-conditional store
 *  identifier (`bundleId` for iOS, `packageName` for Android — matches `createAppSchema`'s
 *  `.refine`s; macOS/Amazon/Web have no required identifier in v1). */
function NewAppDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (appId: string) => void;
}) {
  const createApp = useCreateRcApp(projectId);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<RcAppPlatform>('IOS');
  const [bundleId, setBundleId] = useState('');
  const [packageName, setPackageName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setPlatform('IOS');
    setBundleId('');
    setPackageName('');
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    createApp.mutate(
      {
        name,
        platform,
        bundleId: platform === 'IOS' ? bundleId : undefined,
        packageName: platform === 'ANDROID' ? packageName : undefined,
      },
      {
        onSuccess: (app) => {
          onCreated(app.id);
          handleOpenChange(false);
        },
        onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not create app.')),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle>New app</DialogTitle>
        <DialogDescription>Register a store app to hold products.</DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="new-app-name">Name</Label>
            <Input
              id="new-app-name"
              className="mt-1"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="new-app-platform">Platform</Label>
            <select
              id="new-app-platform"
              className={cn(fieldLook, 'mt-1 w-full')}
              value={platform}
              onChange={(event) => setPlatform(event.target.value as RcAppPlatform)}
            >
              {APP_PLATFORMS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          {platform === 'IOS' && (
            <div>
              <Label htmlFor="new-app-bundle-id">Bundle ID</Label>
              <Input
                id="new-app-bundle-id"
                className="mt-1"
                value={bundleId}
                onChange={(event) => setBundleId(event.target.value)}
                required
              />
            </div>
          )}
          {platform === 'ANDROID' && (
            <div>
              <Label htmlFor="new-app-package-name">Package name</Label>
              <Input
                id="new-app-package-name"
                className="mt-1"
                value={packageName}
                onChange={(event) => setPackageName(event.target.value)}
                required
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createApp.isPending}>
              {createApp.isPending ? 'Creating…' : 'Create app'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Delete app (design §3.2): permanently deletes the app AND every product listed under it
 *  (`Product.app` is `onDelete: Cascade` in `prisma/schema.prisma`), so the copy says so explicitly
 *  instead of leaving that a surprise. Uses `AlertDialogAction` with a manual `preventDefault` +
 *  mutate-then-close, mirroring `RcEntitlementsPage.tsx`'s delete-confirm pattern: Radix's default
 *  auto-close is suppressed so a failed delete keeps the dialog open with the inline error visible
 *  (design §4), and we close it manually on success. */
function DeleteAppAlertDialog({
  projectId,
  app,
  onClose,
}: {
  projectId: string;
  app: RcApp;
  onClose: () => void;
}) {
  const deleteApp = useDeleteRcApp(projectId);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Delete {app.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes the app and every product listed under it, including their entitlement links.
          This cannot be undone.
        </AlertDialogDescription>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="danger"
              disabled={deleteApp.isPending}
              onClick={(event) => {
                event.preventDefault();
                setError(null);
                deleteApp.mutate(app.id, {
                  onSuccess: () => onClose(),
                  onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not delete app.')),
                });
              }}
            >
              {deleteApp.isPending ? 'Deleting…' : 'Delete app'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** New product (design §3.2 header action): `appId` is fixed to the selected app, not a field. */
function NewProductDialog({
  projectId,
  appId,
  open,
  onOpenChange,
}: {
  projectId: string;
  appId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createProduct = useCreateRcProduct(projectId);
  const [storeProductId, setStoreProductId] = useState('');
  const [type, setType] = useState<RcProductType>('AUTO_RENEWABLE_SUBSCRIPTION');
  const [displayName, setDisplayName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('');
  const [duration, setDuration] = useState('');
  const [subscriptionGroupId, setSubscriptionGroupId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStoreProductId('');
    setType('AUTO_RENEWABLE_SUBSCRIPTION');
    setDisplayName('');
    setPrice('');
    setCurrency('');
    setDuration('');
    setSubscriptionGroupId('');
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    createProduct.mutate(
      {
        appId,
        storeProductId,
        type,
        displayName,
        priceCents: price.trim() ? Math.round(parseFloat(price) * 100) : undefined,
        currency: currency.trim() ? currency.trim().toUpperCase() : undefined,
        durationIso8601: duration.trim() || undefined,
        subscriptionGroupId: subscriptionGroupId.trim() || undefined,
      },
      {
        onSuccess: () => handleOpenChange(false),
        onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not create product.')),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle>New product</DialogTitle>
        <DialogDescription>Add a store product for the selected app.</DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="new-product-store-id">Store product ID</Label>
            <Input
              id="new-product-store-id"
              className="mt-1"
              value={storeProductId}
              onChange={(event) => setStoreProductId(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="new-product-type">Type</Label>
            <select
              id="new-product-type"
              className={cn(fieldLook, 'mt-1 w-full')}
              value={type}
              onChange={(event) => setType(event.target.value as RcProductType)}
            >
              {PRODUCT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {productTypeLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="new-product-display-name">Display name</Label>
            <Input
              id="new-product-display-name"
              className="mt-1"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="new-product-price">Price</Label>
              <Input
                id="new-product-price"
                className="mt-1"
                inputMode="decimal"
                placeholder="9.99"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-product-currency">Currency</Label>
              <Input
                id="new-product-currency"
                className="mt-1"
                placeholder="USD"
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="new-product-duration">Duration (ISO 8601)</Label>
            <Input
              id="new-product-duration"
              className="mt-1"
              placeholder="P1M"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-product-group">Subscription group ID</Label>
            <Input
              id="new-product-group"
              className="mt-1"
              value={subscriptionGroupId}
              onChange={(event) => setSubscriptionGroupId(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createProduct.isPending}>
              {createProduct.isPending ? 'Creating…' : 'Create product'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Edit product (design §3.2): `storeProductId`/`type` are identity fields the server's PATCH
 *  rejects (design §1), so they're shown as read-only text, not inputs. */
function EditProductDialog({
  projectId,
  product,
  onClose,
}: {
  projectId: string;
  product: RcProduct;
  onClose: () => void;
}) {
  const updateProduct = useUpdateRcProduct(projectId);
  const [displayName, setDisplayName] = useState(product.displayName);
  const [price, setPrice] = useState(product.priceCents != null ? (product.priceCents / 100).toFixed(2) : '');
  const [currency, setCurrency] = useState(product.currency ?? '');
  const [duration, setDuration] = useState(product.durationIso8601 ?? '');
  const [subscriptionGroupId, setSubscriptionGroupId] = useState(product.subscriptionGroupId ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    updateProduct.mutate(
      {
        id: product.id,
        displayName,
        priceCents: price.trim() ? Math.round(parseFloat(price) * 100) : undefined,
        currency: currency.trim() ? currency.trim().toUpperCase() : undefined,
        durationIso8601: duration.trim() || undefined,
        subscriptionGroupId: subscriptionGroupId.trim() || undefined,
      },
      {
        onSuccess: () => onClose(),
        onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not update product.')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Edit product</DialogTitle>
        <DialogDescription>
          {product.storeProductId} · {productTypeLabel(product.type)}
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="edit-product-display-name">Display name</Label>
            <Input
              id="edit-product-display-name"
              className="mt-1"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-product-price">Price</Label>
              <Input
                id="edit-product-price"
                className="mt-1"
                inputMode="decimal"
                placeholder="9.99"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-product-currency">Currency</Label>
              <Input
                id="edit-product-currency"
                className="mt-1"
                placeholder="USD"
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="edit-product-duration">Duration (ISO 8601)</Label>
            <Input
              id="edit-product-duration"
              className="mt-1"
              placeholder="P1M"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="edit-product-group">Subscription group ID</Label>
            <Input
              id="edit-product-group"
              className="mt-1"
              value={subscriptionGroupId}
              onChange={(event) => setSubscriptionGroupId(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateProduct.isPending}>
              {updateProduct.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Manage entitlements (design §3.2): a checkbox per project entitlement, toggled = attach,
 *  untoggled = detach — each toggle is its own mutation (no batched "Save"), matching the
 *  "Done"-only footer. `checked` reads off `product.entitlements` — the caller (`ProductsManager`)
 *  re-derives `product` from the refetched list on every render, so a toggle's real state (post
 *  invalidate) is what's shown, never an optimistic guess (design §4: no optimistic updates). */
function ManageEntitlementsDialog({
  projectId,
  product,
  entitlements,
  onClose,
}: {
  projectId: string;
  product: RcProduct;
  entitlements: RcEntitlement[];
  onClose: () => void;
}) {
  const attach = useAttachEntitlement(projectId);
  const detach = useDetachEntitlement(projectId);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attachedIds = new Set(product.entitlements.map((entitlement) => entitlement.id));

  const handleToggle = (entitlementId: string, checked: boolean) => {
    setError(null);
    setPendingId(entitlementId);
    const mutation = checked ? attach : detach;
    mutation.mutate(
      { productId: product.id, entitlementId },
      {
        onSuccess: () => setPendingId(null),
        onError: (mutationError) => {
          setPendingId(null);
          setError(apiErrorMessage(mutationError, 'Could not update entitlements.'));
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Manage entitlements — {product.displayName}</DialogTitle>
        <DialogDescription>Choose which entitlements this product grants when purchased.</DialogDescription>
        {entitlements.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">No entitlements defined yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {entitlements.map((entitlement) => (
              <li key={entitlement.id} className="flex items-center gap-2">
                <Checkbox
                  id={`entitlement-${entitlement.id}`}
                  checked={attachedIds.has(entitlement.id)}
                  disabled={pendingId === entitlement.id}
                  onCheckedChange={(checked) => handleToggle(entitlement.id, checked === true)}
                />
                <Label htmlFor={`entitlement-${entitlement.id}`}>
                  {entitlement.displayName} ({entitlement.identifier})
                </Label>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Delete product (design §3.2): also removes its entitlement links (`ProductEntitlement` cascades
 *  off `Product`), stated in the copy so it isn't a surprise. Same `AlertDialogAction` +
 *  `preventDefault` pattern as `DeleteAppAlertDialog`. */
function DeleteProductAlertDialog({
  projectId,
  product,
  onClose,
}: {
  projectId: string;
  product: RcProduct;
  onClose: () => void;
}) {
  const deleteProduct = useDeleteRcProduct(projectId);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Delete {product.displayName}?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes {product.storeProductId} and its entitlement links. This cannot be undone.
        </AlertDialogDescription>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="danger"
              disabled={deleteProduct.isPending}
              onClick={(event) => {
                event.preventDefault();
                setError(null);
                deleteProduct.mutate(product.id, {
                  onSuccess: () => onClose(),
                  onError: (mutationError) =>
                    setError(apiErrorMessage(mutationError, 'Could not delete product.')),
                });
              }}
            >
              {deleteProduct.isPending ? 'Deleting…' : 'Delete product'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
