import { ProblemException } from '../../common/problem-details';

/**
 * RevenueCat-style reserved/invalid App User IDs — accepting one of these corrupts the identity
 * graph (design §3). Deferred from the catalog domain (P0) to this, the customer boundary, since
 * it guards the *customer* identity the SDK asserts, not a catalog resource.
 */
const RESERVED = new Set(['no_user', 'null', 'nil', 'none', '(null)', 'nan', '[]', 'unidentified']);

const MAX_LENGTH = 200;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

// The classic "unset" device-identifier sentinel (IDFA/IDFV/GAID all default to this when the
// user has denied tracking) — a real per-device UUID would never legitimately be an app_user_id.
const ZERO_UUID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/i;

// A conservative, false-positive-averse email shape check — good enough to reject obvious PII.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Throws a 400 ProblemException if `id` is not a valid App User ID. Pure, synchronous, and
 * fail-closed: any ambiguous or malformed input is rejected rather than passed through.
 *
 * @param id the SDK-asserted app_user_id.
 * @param reservedStoreIds identifiers the id must not collide with — the owning App's
 *   publicSdkKey/bundleId/packageName, supplied by the caller (this function has no App lookup).
 */
export function assertValidAppUserId(id: string, reservedStoreIds: string[] = []): void {
  const bad = (message: string): never => {
    throw new ProblemException({ status: 400, title: 'Invalid app user id', detail: message });
  };

  if (typeof id !== 'string') bad('app user id must be a string');

  const trimmed = id.trim();
  if (trimmed.length === 0) bad('app user id must not be empty');
  if (trimmed.length > MAX_LENGTH) bad(`app user id must be <= ${MAX_LENGTH} characters`);
  if (CONTROL_CHARS.test(trimmed)) bad('app user id must not contain control characters');
  if (RESERVED.has(trimmed.toLowerCase())) bad(`"${trimmed}" is a reserved app user id`);
  if (trimmed.startsWith('$')) bad('app user id must not use the reserved "$" sentinel prefix');
  if (ZERO_UUID.test(trimmed)) bad('app user id must not be a zeroed device identifier');
  if (EMAIL_SHAPE.test(trimmed)) bad('app user id must not be an email address / PII');
  if (reservedStoreIds.some((storeId) => storeId === trimmed)) {
    bad('app user id must not equal the app\'s own store identifier');
  }
}
