import { ProblemException } from '../../common/problem-details';

/** RevenueCat's reserved/invalid App User IDs — accepting these corrupts the identity graph. */
const RESERVED = new Set([
  'no_user', 'null', 'none', 'nil', '(null)', 'nan', 'unidentified', 'unknown', 'undefined',
]);
const MAX_LENGTH = 1500;

/**
 * Throws a 400 ProblemException if `id` is not a valid App User ID, replicating RevenueCat's rules:
 * non-empty, not a reserved sentinel, not PII-shaped (email), not a store bundle/package id, bounded
 * length, no control characters.
 */
export function assertValidAppUserId(id: string, reservedStoreIds: string[] = []): void {
  const trimmed = id?.trim() ?? '';
  const bad = (message: string): never => {
    throw new ProblemException({ status: 400, title: 'Invalid app user id', detail: message });
  };
  if (trimmed.length === 0) bad('app user id must not be empty');
  if (trimmed.length > MAX_LENGTH) bad(`app user id must be <= ${MAX_LENGTH} characters`);
  if (RESERVED.has(trimmed.toLowerCase())) bad(`"${id}" is a reserved app user id`);
  if (trimmed.includes('@')) bad('app user id must not be an email / PII');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) bad('app user id must not contain control characters');
  if (reservedStoreIds.some((s) => s === trimmed)) bad('app user id must not equal a store identifier');
}
