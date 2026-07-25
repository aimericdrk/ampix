import { useState, type ChangeEvent, type FormEvent } from 'react';
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
import { Textarea } from '../../../components/ui/textarea';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import type { RcApp } from '../catalog-api';
import { useDisconnectStoreCredentials, useSetStoreCredentials } from '../store-credentials-api';

/** Renders an `ApiError`'s detail/title inline; any non-API error falls back. Mirrors the helper of
 *  the same name in `RcCustomerDetailPage.dialogs.tsx`. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

interface DialogError {
  general?: string;
  fields?: Record<string, string[]>;
}

/** Maps a failed `useSetStoreCredentials` mutation to inline dialog state (design §2/§3): 503 → the
 *  enc-key hint, 422 → per-field errors (+ any `detail`), anything else → one general message. */
function toDialogError(error: unknown): DialogError {
  if (error instanceof ApiError) {
    if (error.problem.status === 503) {
      return { general: 'Set STORE_CREDENTIALS_ENC_KEY on the server first.' };
    }
    if (error.problem.errors) {
      return { fields: error.problem.errors, general: error.problem.detail };
    }
    return { general: error.problem.detail ?? error.problem.title };
  }
  return { general: 'Could not connect the store.' };
}

function FieldErrors({ error, field }: { error: DialogError | null; field: string }) {
  const messages = error?.fields?.[field];
  if (!messages || messages.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {messages.map((message) => (
        <li key={message} role="alert" className="text-sm text-danger">
          {message}
        </li>
      ))}
    </ul>
  );
}

/** File-upload convenience: the native `<input type="file">` fills the paste field so the two entry
 *  paths converge on one controlled value. `File.text()` is available in jsdom. */
async function readFileText(event: ChangeEvent<HTMLInputElement>): Promise<string | null> {
  const file = event.target.files?.[0];
  return file ? file.text() : null;
}

export function GooglePlayConnectDialog({
  projectId,
  app,
  onClose,
}: {
  projectId: string;
  app: RcApp;
  onClose: () => void;
}) {
  const setCredentials = useSetStoreCredentials(projectId, app.id);
  const { toast } = useToast();
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [error, setError] = useState<DialogError | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const text = await readFileText(event);
    if (text !== null) setServiceAccountJson(text);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setCredentials.mutate(
      { kind: 'google_play', serviceAccountJson },
      {
        onSuccess: (status) => {
          onClose();
          toast({
            title: status.liveVerified ? 'Store connected' : 'Connected — live verification pending',
          });
        },
        onError: (mutationError) => setError(toDialogError(mutationError)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Connect Google Play</DialogTitle>
        <DialogDescription>
          Paste the Google Play service-account JSON for {app.name}. It’s encrypted at rest and never
          shown again.
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="gp-json" className="mb-1 block">
              Service account JSON
            </Label>
            <Textarea
              id="gp-json"
              aria-label="Service account JSON"
              value={serviceAccountJson}
              onChange={(event) => setServiceAccountJson(event.target.value)}
            />
            <FieldErrors error={error} field="serviceAccountJson" />
          </div>
          <div>
            <Label htmlFor="gp-file" className="mb-1 block">
              …or upload the .json file
            </Label>
            <input id="gp-file" type="file" accept="application/json,.json" onChange={handleFile} />
          </div>
          {error?.general && (
            <p role="alert" className="text-sm text-danger">
              {error.general}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={setCredentials.isPending}>
              {setCredentials.isPending ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AppStoreConnectDialog({
  projectId,
  app,
  onClose,
}: {
  projectId: string;
  app: RcApp;
  onClose: () => void;
}) {
  const setCredentials = useSetStoreCredentials(projectId, app.id);
  const { toast } = useToast();
  const [ascIssuerId, setAscIssuerId] = useState('');
  const [ascKeyId, setAscKeyId] = useState('');
  const [appAppleId, setAppAppleId] = useState('');
  const [ascPrivateKeyP8, setAscPrivateKeyP8] = useState('');
  const [error, setError] = useState<DialogError | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const text = await readFileText(event);
    if (text !== null) setAscPrivateKeyP8(text);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setCredentials.mutate(
      { kind: 'app_store', ascIssuerId, ascKeyId, ascPrivateKeyP8, appAppleId },
      {
        onSuccess: (status) => {
          onClose();
          toast({
            title: status.liveVerified ? 'Store connected' : 'Connected — live verification pending',
          });
        },
        onError: (mutationError) => setError(toDialogError(mutationError)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Connect App Store</DialogTitle>
        <DialogDescription>
          Paste the App Store Connect API key and ASSN config for {app.name}. Credentials are
          encrypted at rest and never shown again.
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="asc-issuer" className="mb-1 block">
              Issuer ID
            </Label>
            <Input
              id="asc-issuer"
              aria-label="Issuer ID"
              value={ascIssuerId}
              onChange={(event) => setAscIssuerId(event.target.value)}
            />
            <FieldErrors error={error} field="ascIssuerId" />
          </div>
          <div>
            <Label htmlFor="asc-key-id" className="mb-1 block">
              Key ID
            </Label>
            <Input
              id="asc-key-id"
              aria-label="Key ID"
              value={ascKeyId}
              onChange={(event) => setAscKeyId(event.target.value)}
            />
            <FieldErrors error={error} field="ascKeyId" />
          </div>
          <div>
            <Label htmlFor="asc-app-apple-id" className="mb-1 block">
              App Store Connect app ID
            </Label>
            <Input
              id="asc-app-apple-id"
              aria-label="App Store Connect app ID"
              value={appAppleId}
              onChange={(event) => setAppAppleId(event.target.value)}
            />
            <FieldErrors error={error} field="appAppleId" />
          </div>
          <div>
            <Label htmlFor="asc-bundle-id" className="mb-1 block">
              Bundle ID
            </Label>
            <Input id="asc-bundle-id" aria-label="Bundle ID" value={app.bundleId ?? ''} readOnly disabled />
          </div>
          <div>
            <Label htmlFor="asc-p8" className="mb-1 block">
              .p8 private key
            </Label>
            <Textarea
              id="asc-p8"
              aria-label=".p8 private key"
              value={ascPrivateKeyP8}
              onChange={(event) => setAscPrivateKeyP8(event.target.value)}
            />
            <FieldErrors error={error} field="ascPrivateKeyP8" />
          </div>
          <div>
            <Label htmlFor="asc-p8-file" className="mb-1 block">
              …or upload the .p8 file
            </Label>
            <input id="asc-p8-file" type="file" accept=".p8" onChange={handleFile} />
          </div>
          {error?.general && (
            <p role="alert" className="text-sm text-danger">
              {error.general}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={setCredentials.isPending}>
              {setCredentials.isPending ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Disconnect (design §1.4): clears the stored credential. Same suppress-auto-close +
 *  `preventDefault` `AlertDialogAction` pattern as `RcCustomerDetailPage.dialogs.tsx`, but the
 *  outcome is a toast (the row refetches to Not connected off the hook's apps invalidation). */
export function DisconnectStoreAlertDialog({
  projectId,
  app,
  onClose,
}: {
  projectId: string;
  app: RcApp;
  onClose: () => void;
}) {
  const disconnect = useDisconnectStoreCredentials(projectId, app.id);
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Disconnect {app.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          The stored store credentials for this app are deleted. Store-authoritative actions (refunds,
          live checks) stop working until you reconnect. This cannot be undone.
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
              disabled={disconnect.isPending}
              onClick={(event) => {
                event.preventDefault();
                setError(null);
                disconnect.mutate(undefined, {
                  onSuccess: () => {
                    onClose();
                    toast({ title: 'Store disconnected' });
                  },
                  onError: (mutationError) =>
                    setError(apiErrorMessage(mutationError, 'Could not disconnect this store.')),
                });
              }}
            >
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
