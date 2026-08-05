export interface RuntimeConfig {
  /** Backend origin. '' means same-origin (dev proxy / reverse-proxied prod). */
  apiBaseUrl: string;
  /**
   * mobile_purchase (billing-authority) service origin for the MyRevenueCat data pages. '' means
   * same-origin; set to the mobile_purchase origin when it is a distinct host — both services
   * expose /api/v1/projects/:projectId/…, so they cannot share apiBaseUrl. Set by X1 in prod / the
   * mobile_purchase dev server origin in dev.
   */
  purchaseApiBaseUrl: string;
}

declare global {
  interface Window {
    ___MYAMPIX_CONFIG__?: Partial<RuntimeConfig>;
  }
}

const DEFAULTS: RuntimeConfig = {
  apiBaseUrl: '',
  purchaseApiBaseUrl: '',
};

/** Merges the runtime config injected by /config.js over dev-safe defaults. */
export function getRuntimeConfig(): RuntimeConfig {
  return { ...DEFAULTS, ...window.___MYAMPIX_CONFIG__ };
}
