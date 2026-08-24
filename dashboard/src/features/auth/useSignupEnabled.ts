import { useEffect, useState } from 'react';
import { getAuthConfig } from './api';

/**
 * Whether this instance accepts self-service signups (backend SIGNUP_ENABLED).
 * `null` while unknown; callers treat only an explicit `false` as "hide registration",
 * so a slow or failing config fetch never locks a normal instance's register flow.
 */
export function useSignupEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then((cfg) => {
        if (!cancelled) setEnabled(cfg.signup_enabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(true); // unknown → assume open (endpoint still enforces)
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
