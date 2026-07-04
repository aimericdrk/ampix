import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { ApiError } from '../../../lib/api/problem';
import type { Setup2faResponse } from '../../../lib/api/types';
import { activate2fa, disable2fa, getMe, ME_QUERY_KEY, setup2fa } from '../api';

export function SecuritySettingsPage() {
  const query = useQuery({ queryKey: ME_QUERY_KEY, queryFn: getMe });

  return (
    <section className="max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold">Security</h1>
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isPending && <p role="status">Loading…</p>}
          {query.error && (
            <p role="alert" className="text-danger">
              {query.error instanceof ApiError
                ? query.error.problem.title
                : 'Failed to load security settings'}
            </p>
          )}
          {query.data &&
            (query.data.two_factor_enabled ? <DisableTwoFactor /> : <EnableTwoFactor />)}
        </CardContent>
      </Card>
    </section>
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
        <p className="text-sm">
          Save these recovery codes somewhere safe. Each one can be used once if you lose access to
          your authenticator app. They will not be shown again.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-bg p-3 font-mono text-sm">
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
          className="rounded-md border border-border"
        />
        <div>
          <span className="mb-1 block text-sm font-medium">Manual entry secret</span>
          <code className="block break-all rounded-md bg-bg p-2 text-sm">{setupData.secret}</code>
        </div>
        <div>
          <label htmlFor="activate-code" className="mb-1 block text-sm font-medium">
            Enter the 6-digit code
          </label>
          <Input
            id="activate-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            aria-invalid={Boolean(activateProblem)}
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
      <p className="text-sm text-text-muted">
        Two-factor authentication is currently enabled. Enter a current code to turn it off.
      </p>
      <div>
        <label htmlFor="disable-code" className="mb-1 block text-sm font-medium">
          Authentication code
        </label>
        <Input
          id="disable-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          aria-invalid={Boolean(problem)}
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
