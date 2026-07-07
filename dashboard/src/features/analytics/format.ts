/** Auto-compact number formatting for stat-tile headline values (1,284 / 12.9K / 4.2M). */
export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

/** Full, comma-grouped integer — used in tables where every digit matters. */
export function formatExactNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/** A conversion/retention rate in [0,1] as a percent: `0.234` -> `23.4%`; `0.62` -> `62%`; `1` -> `100%`. */
export function formatPercent(rate: number): string {
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(rate);
}

/** A monetary amount, default USD (the Revenue page's `$price` sums aren't currency-tagged yet). */
export function formatCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

/** `245000` -> `4m 5s`; `900` -> `0.9s`; `0` -> `0s`. */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
