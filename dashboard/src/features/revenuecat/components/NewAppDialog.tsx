import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { fieldLook, Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { ApiError } from '../../../lib/api/problem';
import { cn } from '../../../lib/cn';
import { useCreateRcApp, type RcAppPlatform } from '../catalog-api';

const APP_PLATFORMS: RcAppPlatform[] = ['IOS', 'ANDROID', 'MACOS', 'AMAZON', 'WEB'];

/** Renders an `ApiError`'s problem detail (falling back to its title) so a failed submit shows the
 *  server's actual reason inline; any other error keeps a generic fallback. Mirrors the copy used
 *  across the other MyRevenueCat dialogs. */
function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

/**
 * New app (design §3.2 header action): name, platform, and the platform-conditional store
 * identifier (`bundleId` for iOS, `packageName` for Android — matches `createAppSchema`'s
 * `.refine`s; macOS/Amazon/Web have no required identifier in v1).
 *
 * Shared by both `RcProductsPage` (its header action / empty state) and `RcSettingsPage` (so a
 * store can be connected without first hopping to Products). `useCreateRcApp` invalidates the apps
 * query on success, so both pages' lists refresh on their own; `onCreated` receives the new app id
 * for any caller that wants to act on it (Products navigates to the app's products).
 */
export function NewAppDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (appId: string) => void;
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
          onCreated?.(app.id);
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
