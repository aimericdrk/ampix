/**
 * Minimal RFC-4180-ish CSV helpers for client-side data export. `toCsv` is a pure string
 * builder (easy to unit-test); `downloadCsv` is the DOM side-effect that triggers a browser
 * download via a Blob + object URL.
 */

/** Quotes a field if it contains a comma, quote, or newline; doubles interior quotes. */
function escapeField(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Builds a CSV string from headers + rows, quoting fields per RFC 4180 and using `\r\n` line
 * endings. Purely a string transform — no DOM/browser APIs — so it's trivially unit-testable.
 */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((line) => line.map(escapeField).join(','));
  return lines.join('\r\n');
}

/**
 * Triggers a browser download of `csv` as `filename` (a `.csv` suffix is appended if missing)
 * via a Blob + temporary object URL. No-ops outside a DOM environment (e.g. plain unit tests)
 * so callers don't need to guard every call site.
 */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;

  const name = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
