import type { ConsoleMessage, Page } from '@playwright/test';

/**
 * Wires console-error + uncaught-page-error capture for one browser page, mirroring
 * data-flow.func.spec.ts's approach. Shared here because tenancy.func.spec.ts drives TWO
 * actors (admin + invited member) in two separate browser contexts and must track both.
 *
 * Every fresh page load silently probes for a prior session via
 * POST /api/v1/auth/refresh (router.tsx's ensureAuthResolved -> client.ts's
 * restoreSession). Before that page's own first sign-up/login there is no refresh cookie
 * yet, so Chromium logs the resulting 401 as a "failed resource load" — expected noise,
 * not an app bug. `isAuthenticated()` lets each call site flip that suppression off the
 * moment its own actor becomes authenticated, so any LATER 401 still fails the test.
 *
 * All pushed messages are prefixed with `label` so a failure clearly shows which actor
 * (admin/member) produced it.
 */
export function trackPageErrors(
  page: Page,
  label: string,
  errors: string[],
  isAuthenticated: () => boolean,
): void {
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (text.includes('favicon.ico')) return;
    if (!isAuthenticated() && text.includes('401')) return;
    errors.push(`[${label}] ${text}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`[${label}] pageerror: ${err.message}`);
  });
}
