/**
 * Single enforcement point for post-auth `?redirect=` targets (open-redirect guard): only
 * same-app absolute paths pass — must start with '/' but not '//' (protocol-relative URL), and
 * must not contain '\\' (browsers treat backslashes as slashes when resolving URLs, so
 * '/\\evil.com' would be a protocol-relative bypass). Anything else resolves to `undefined` so
 * callers fall back to their own default destination.
 */
export function sanitizeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
    ? value
    : undefined;
}
