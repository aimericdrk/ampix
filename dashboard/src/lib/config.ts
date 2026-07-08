export interface RuntimeConfig {
  /** Backend origin. '' means same-origin (dev proxy / reverse-proxied prod). */
  apiBaseUrl: string;
}

declare global {
  interface Window {
    ___MYAMPIX_CONFIG__?: Partial<RuntimeConfig>;
  }
}

const DEFAULTS: RuntimeConfig = {
  apiBaseUrl: '',
};

/** Merges the runtime config injected by /config.js over dev-safe defaults. */
export function getRuntimeConfig(): RuntimeConfig {
  return { ...DEFAULTS, ...window.___MYAMPIX_CONFIG__ };
}
