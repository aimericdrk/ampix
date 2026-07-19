import { useState, type FormEvent } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { ApiError } from '../../../lib/api/problem';
import {
  useAddPackage,
  useCreateRcOffering,
  useDeleteRcOffering,
  useRemovePackage,
  useUpdatePackage,
  useUpdateRcOffering,
  type RcOffering,
  type RcPackage,
  type RcPackageType,
  type RcProduct,
} from '../catalog-api';

/** Every `Package.packageType` value `createPackageSchema`/`updatePackageSchema` accept
 *  (`backend/mobile_purchase/src/catalog/support/catalog.schemas.ts`). */
export const PACKAGE_TYPES: RcPackageType[] = [
  'UNKNOWN',
  'CUSTOM',
  'LIFETIME',
  'ANNUAL',
  'SIX_MONTH',
  'THREE_MONTH',
  'TWO_MONTH',
  'MONTHLY',
  'WEEKLY',
];

/** `${displayName} (${storeProductId})` — the label used everywhere a product is picked or shown. */
export function productLabel(product: RcProduct): string {
  return `${product.displayName} (${product.storeProductId})`;
}

/** Resolves a package's `productId` against the loaded product list; "Unknown product" while
 *  `useRcProducts` is still in flight or for a stale/deleted id, rather than crashing. */
export function resolveProductLabel(products: RcProduct[], productId: string): string {
  const product = products.find((p) => p.id === productId);
  return product ? productLabel(product) : 'Unknown product';
}

/** Renders an `ApiError`'s problem detail (falling back to its title) so a failed dialog submit
 *  shows the server's actual reason inline and keeps the dialog open (design §4); any other error
 *  keeps a generic fallback. Mirrors `RcEntitlementsPage.tsx`'s/`RcProductsPage.tsx`'s helper of the
 *  same name. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

/** Create when `offering` is omitted, edit when given (identifier becomes read-only, and the submit
 *  targets `useUpdateRcOffering` instead of `useCreateRcOffering`). Mirrors `RcProductsPage.tsx`'s
 *  `NewAppDialog`/`EditProductDialog` split-by-prop convention, combined into one component since
 *  create/edit share almost every field here. */
export function OfferingFormDialog({
  projectId,
  offering,
  open,
  onOpenChange,
}: {
  projectId: string;
  offering?: RcOffering;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = offering !== undefined;
  const createOffering = useCreateRcOffering(projectId);
  const updateOffering = useUpdateRcOffering(projectId);
  const pending = isEdit ? updateOffering.isPending : createOffering.isPending;

  const [identifier, setIdentifier] = useState(offering?.identifier ?? '');
  const [displayName, setDisplayName] = useState(offering?.displayName ?? '');
  const [metadataText, setMetadataText] = useState(
    offering?.metadata != null ? JSON.stringify(offering.metadata, null, 2) : '',
  );
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setIdentifier(offering?.identifier ?? '');
    setDisplayName(offering?.displayName ?? '');
    setMetadataText(offering?.metadata != null ? JSON.stringify(offering.metadata, null, 2) : '');
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    let metadata: unknown;
    if (metadataText.trim().length > 0) {
      try {
        metadata = JSON.parse(metadataText);
      } catch {
        setError('Metadata must be valid JSON.');
        return;
      }
    }
    const onError = (mutationError: unknown) =>
      setError(apiErrorMessage(mutationError, `Could not ${isEdit ? 'update' : 'create'} offering.`));
    if (isEdit) {
      updateOffering.mutate(
        { id: offering.id, displayName, ...(metadata !== undefined ? { metadata } : {}) },
        { onSuccess: () => handleOpenChange(false), onError },
      );
    } else {
      createOffering.mutate(
        { identifier, displayName, ...(metadata !== undefined ? { metadata } : {}) },
        { onSuccess: () => handleOpenChange(false), onError },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle>{isEdit ? 'Edit offering' : 'New offering'}</DialogTitle>
        <DialogDescription>
          {isEdit ? `${offering.identifier} — identifier can’t be changed.` : 'Offerings group packages for the paywall.'}
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="offering-identifier" className="mb-1 block">
              Identifier
            </Label>
            <Input
              id="offering-identifier"
              value={isEdit ? offering.identifier : identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              disabled={isEdit}
              readOnly={isEdit}
              required
            />
          </div>
          <div>
            <Label htmlFor="offering-display-name" className="mb-1 block">
              Display name
            </Label>
            <Input
              id="offering-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="offering-metadata" className="mb-1 block">
              Metadata (JSON{isEdit ? '' : ', optional'})
            </Label>
            <Textarea
              id="offering-metadata"
              value={metadataText}
              onChange={(event) => setMetadataText(event.target.value)}
              placeholder='{"tier": "premium"}'
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
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create offering'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Delete offering (spec §3.3): also removes every package listed under it (`Package.offering` is
 *  `onDelete: Cascade`), stated in the copy so it isn't a surprise. Same `AlertDialogAction` +
 *  `preventDefault` pattern as `RcProductsPage.tsx`'s `DeleteAppAlertDialog`/`DeleteProductAlertDialog`:
 *  Radix's default auto-close is suppressed so a failed delete keeps the dialog open with the inline
 *  error visible, and we close it manually on success. */
export function DeleteOfferingAlertDialog({
  projectId,
  offering,
  onClose,
}: {
  projectId: string;
  offering: RcOffering;
  onClose: () => void;
}) {
  const deleteOffering = useDeleteRcOffering(projectId);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Delete {offering.identifier}?</AlertDialogTitle>
        <AlertDialogDescription>
          Its {offering.packages.length} package(s) are removed with it. This cannot be undone.
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
              disabled={deleteOffering.isPending}
              onClick={(event) => {
                event.preventDefault();
                setError(null);
                deleteOffering.mutate(offering.id, {
                  onSuccess: () => onClose(),
                  onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not delete offering.')),
                });
              }}
            >
              {deleteOffering.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Add when `pkg` is omitted, edit when given (identifier/product become fixed — the backend PATCH
 *  only accepts `packageType`/`sortOrder`, matching `UpdateRcPackageInput`). */
export function PackageFormDialog({
  projectId,
  offeringId,
  pkg,
  products,
  open,
  onOpenChange,
}: {
  projectId: string;
  offeringId: string;
  pkg?: RcPackage;
  products: RcProduct[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = pkg !== undefined;
  const addPackage = useAddPackage(projectId);
  const updatePackage = useUpdatePackage(projectId);
  const pending = isEdit ? updatePackage.isPending : addPackage.isPending;

  const [identifier, setIdentifier] = useState(pkg?.identifier ?? '');
  const [packageType, setPackageType] = useState<RcPackageType>(pkg?.packageType ?? 'CUSTOM');
  const [productId, setProductId] = useState(pkg?.productId ?? products[0]?.id ?? '');
  const [sortOrder, setSortOrder] = useState(String(pkg?.sortOrder ?? 0));
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setIdentifier(pkg?.identifier ?? '');
    setPackageType(pkg?.packageType ?? 'CUSTOM');
    setProductId(pkg?.productId ?? products[0]?.id ?? '');
    setSortOrder(String(pkg?.sortOrder ?? 0));
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const onError = (mutationError: unknown) =>
      setError(apiErrorMessage(mutationError, `Could not ${isEdit ? 'update' : 'add'} package.`));
    if (isEdit) {
      updatePackage.mutate(
        { offeringId, packageId: pkg.id, packageType, sortOrder: Number(sortOrder) || 0 },
        { onSuccess: () => handleOpenChange(false), onError },
      );
      return;
    }
    if (!productId) {
      setError('Choose a product.');
      return;
    }
    addPackage.mutate(
      { offeringId, identifier, packageType, productId, sortOrder: Number(sortOrder) || 0 },
      { onSuccess: () => handleOpenChange(false), onError },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle>{isEdit ? 'Edit package' : 'Add package'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? `${pkg.identifier} → ${resolveProductLabel(products, pkg.productId)}`
            : 'Attach a product to this offering’s paywall.'}
        </DialogDescription>
        {!isEdit && products.length === 0 ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              Create a product first (Products page) — every package must reference one.
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            {!isEdit && (
              <div>
                <Label htmlFor="package-identifier" className="mb-1 block">
                  Identifier
                </Label>
                <Input
                  id="package-identifier"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  required
                />
              </div>
            )}
            <div>
              <Label className="mb-1 block">Package type</Label>
              <Select value={packageType} onValueChange={(value) => setPackageType(value as RcPackageType)}>
                <SelectTrigger aria-label="Package type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PACKAGE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!isEdit && (
              <div>
                <Label className="mb-1 block">Product</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger aria-label="Product">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {productLabel(product)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="package-sort-order" className="mb-1 block">
                Sort order
              </Label>
              <Input
                id="package-sort-order"
                type="number"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
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
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add package'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Remove package (spec §3.3 package row action). Same `AlertDialogAction` + `preventDefault`
 *  pattern as `DeleteOfferingAlertDialog`. */
export function RemovePackageAlertDialog({
  projectId,
  offeringId,
  pkg,
  onClose,
}: {
  projectId: string;
  offeringId: string;
  pkg: RcPackage;
  onClose: () => void;
}) {
  const removePackage = useRemovePackage(projectId);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Remove {pkg.identifier}?</AlertDialogTitle>
        <AlertDialogDescription>This removes it from the offering. This cannot be undone.</AlertDialogDescription>
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
              disabled={removePackage.isPending}
              onClick={(event) => {
                event.preventDefault();
                setError(null);
                removePackage.mutate(
                  { offeringId, packageId: pkg.id },
                  {
                    onSuccess: () => onClose(),
                    onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not remove package.')),
                  },
                );
              }}
            >
              {removePackage.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
