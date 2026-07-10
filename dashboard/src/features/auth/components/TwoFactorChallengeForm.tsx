import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { ApiError } from '../../../lib/api/problem';
import { verify2fa } from '../api';

interface TwoFactorChallengeFormProps {
  /** Short-lived mfa_token from the login step-up response — never persisted (contracts §11). */
  mfaToken: string;
  onVerified: () => void;
}

/** The 2FA login challenge: a 6-digit TOTP code, or a recovery code, exchanged for a real session. */
export function TwoFactorChallengeForm({ mfaToken, onVerified }: TwoFactorChallengeFormProps) {
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);

  const mutation = useMutation({
    mutationFn: () => verify2fa({ mfa_token: mfaToken, code }),
    onSuccess: onVerified,
  });

  const problem = mutation.error instanceof ApiError ? mutation.error.problem : null;
  const showRequiredError = touched && !code.trim();
  const inlineError =
    problem?.title ??
    (mutation.isError && !problem ? 'Something went wrong. Please try again.' : null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!code.trim()) return;
    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <Label htmlFor="mfa-code" className="mb-1 block">
          Authentication code
        </Label>
        <p className="mb-2 text-sm text-text-muted">
          Enter the 6-digit code from your authenticator app, or a recovery code.
        </p>
        <Input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          aria-invalid={Boolean(showRequiredError || problem)}
          className="font-display text-center text-lg tracking-[0.3em]"
          onChange={(e) => {
            setCode(e.target.value);
            mutation.reset();
          }}
        />
        {showRequiredError && (
          <p role="alert" className="mt-1 text-sm text-danger">
            Enter the code from your authenticator app
          </p>
        )}
      </div>
      {inlineError && (
        <p role="alert" className="text-sm text-danger">
          {inlineError}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Verifying…' : 'Verify'}
      </Button>
    </form>
  );
}
