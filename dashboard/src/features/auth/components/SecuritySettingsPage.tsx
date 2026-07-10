import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Badge } from '../../../components/ui/badge';
import { Banner } from '../../../components/ui/banner';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { ApiError } from '../../../lib/api/problem';
import type { Setup2faResponse } from '../../../lib/api/types';
import { activate2fa, disable2fa, ME_QUERY_KEY, setup2fa } from '../api';

/**
 * Two-factor authentication section, rendered as a card inside `AccountPage` (the merged
 * account + security page — `/settings/security` used to be its own route and now redirects to
 * `/account`). `AccountPage` owns the single `getMe` query for the whole page, including its
 * loading/error states, so this section only needs the resolved `two_factor_enabled` flag.
 */
export function TwoFactorSection({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Two-factor authentication</CardTitle>
        <Badge variant={twoFactorEnabled ? 'success' : 'outline'}>
          {twoFactorEnabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </CardHeader>
      <CardContent>{twoFactorEnabled ? <DisableTwoFactor /> : <EnableTwoFactor />}</CardContent>
    </Card>
  );
}

function EnableTwoFactor() {
  const queryClient = useQueryClient();
  const [setupData, setSetupData] = useState<Setup2faResponse | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const setupMutation = useMutation({
    mutationFn: setup2fa,
    onSuccess: setSetupData,
  });

  const activateMutation = useMutation({
    mutationFn: () => activate2fa({ code }),
    onSuccess: (data) => setRecoveryCodes(data.recovery_codes),
  });

  const activateProblem =
    activateMutation.error instanceof ApiError ? activateMutation.error.problem : null;

  const handleActivate = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    activateMutation.mutate();
  };

  const handleDone = () => {
    // The codes were shown once; the server never returns them again. Refetch
    // `me` so the page flips to the "on" (Disable 2FA) view.
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  };

  const handleCopy = () => {
    if (!recoveryCodes || !navigator.clipboard) return;
    navigator.clipboard.writeText(recoveryCodes.join('\n')).catch(() => {});
  };

  if (recoveryCodes) {
    return (
      <div className="space-y-4">
        {/* Permanently visible while this view is shown — role="note", not a live alert. */}
        <Banner variant="warning" role="note">
          Save these recovery codes somewhere safe. Each one can be used once if you lose access
          to your authenticator app. They will not be shown again.
        </Banner>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-bg p-3 font-mono text-sm">
          {recoveryCodes.map((recoveryCode) => (
            <li key={recoveryCode}>{recoveryCode}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={handleCopy}>
            Copy codes
          </Button>
          <Button type="button" className="flex-1" onClick={handleDone}>
            I&apos;ve saved my recovery codes
          </Button>
        </div>
      </div>
    );
  }

  if (setupData) {
    return (
      <form onSubmit={handleActivate} noValidate className="space-y-4">
        <p className="text-sm text-text-muted">
          Scan this QR code with Google Authenticator (or any TOTP-compatible app), or enter the
          secret manually.
        </p>
        <img
          src={setupData.qr_data_url}
          alt="2FA setup QR code"
          width={200}
          height={200}
          className="rounded-lg border border-border"
        />
        <div>
          <span className="mb-1 block text-sm font-medium">Manual entry secret</span>
          <code className="block break-all rounded-lg bg-bg p-2 text-sm">{setupData.secret}</code>
        </div>
        <div>
          <Label htmlFor="activate-code" className="mb-1 block">
            Enter the 6-digit code
          </Label>
          <Input
            id="activate-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            aria-invalid={Boolean(activateProblem)}
            className="font-display text-center text-lg tracking-[0.3em]"
            onChange={(e) => {
              setCode(e.target.value);
              activateMutation.reset();
            }}
          />
        </div>
        {activateProblem && (
          <p role="alert" className="text-sm text-danger">
            {activateProblem.title}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={activateMutation.isPending}>
          {activateMutation.isPending ? 'Activating…' : 'Activate 2FA'}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Two-factor authentication is currently disabled. Enable it to require a code from an
        authenticator app at login.
      </p>
      <Button onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
        {setupMutation.isPending ? 'Starting…' : 'Enable 2FA'}
      </Button>
      {setupMutation.error && (
        <p role="alert" className="text-sm text-danger">
          {setupMutation.error instanceof ApiError
            ? setupMutation.error.problem.title
            : 'Failed to start 2FA setup'}
        </p>
      )}
    </div>
  );
}

function DisableTwoFactor() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');

  const mutation = useMutation({
    mutationFn: () => disable2fa({ code }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });

  const problem = mutation.error instanceof ApiError ? mutation.error.problem : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {/* Permanently visible while 2FA is on — role="note", not a live alert. */}
      <Banner variant="warning" role="note">
        Two-factor authentication is currently enabled. Enter a current code to turn it off.
      </Banner>
      <div>
        <Label htmlFor="disable-code" className="mb-1 block">
          Authentication code
        </Label>
        <Input
          id="disable-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          aria-invalid={Boolean(problem)}
          className="font-display text-center text-lg tracking-[0.3em]"
          onChange={(e) => {
            setCode(e.target.value);
            mutation.reset();
          }}
        />
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem.title}
        </p>
      )}
      <Button type="submit" variant="danger" disabled={mutation.isPending}>
        {mutation.isPending ? 'Disabling…' : 'Disable 2FA'}
      </Button>
    </form>
  );
}
