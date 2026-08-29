/**
 * Reading a person's identity off a free-form analytics profile.
 *
 * Profile properties are whatever the host app sent through `people.set({...})` — there is no
 * schema and no guaranteed key. These helpers centralise (a) which spellings we accept for each
 * field and (b) the fallback order the UI shows, so the Users list, the command palette, the
 * profile modal and Home's Favorites/Recently-viewed all identify the same person the same way.
 *
 * Contact line: **email → phone → distinct id**. The distinct id is the last resort precisely
 * because it is the one value that always exists but tells a human nothing.
 */

/** A profile as the API returns it: free-form keys, primitive values. */
export type UserProfileProps = Record<string, string | number | boolean | null>;

/** Accepted spellings per field, in priority order. `$`-prefixed keys mirror the SDK convention. */
const NAME_KEYS = ['name', '$name', 'full_name', 'fullName', 'username'] as const;
const EMAIL_KEYS = ['email', '$email'] as const;
/** Kept in sync with the backend's `USER_PHONE_PROFILE_KEYS` (analytics.shared.ts). */
const PHONE_KEYS = ['phone', '$phone', 'phone_number', 'phoneNumber'] as const;
const AGE_KEYS = ['age', '$age'] as const;
const CITY_KEYS = ['city', '$city', 'town', 'locality'] as const;

/**
 * First key in `keys` whose value is a non-empty string once trimmed. Numbers and booleans are
 * stringified (an app may well send `age: 34`); `null` and `''` count as absent, matching how the
 * backend maps empty profile strings to `null`.
 */
function firstProp(profile: UserProfileProps | undefined, keys: readonly string[]): string | null {
  if (!profile) return null;
  for (const key of keys) {
    const value = profile[key];
    if (value === null || value === undefined || typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

export function profileName(profile: UserProfileProps | undefined): string | null {
  return firstProp(profile, NAME_KEYS);
}

export function profileEmail(profile: UserProfileProps | undefined): string | null {
  return firstProp(profile, EMAIL_KEYS);
}

export function profilePhone(profile: UserProfileProps | undefined): string | null {
  return firstProp(profile, PHONE_KEYS);
}

export function profileCity(profile: UserProfileProps | undefined): string | null {
  return firstProp(profile, CITY_KEYS);
}

/**
 * The age as a display string. Apps send it either as a number (`34`) or a string (`'34'`), so the
 * value is passed through as text; a non-numeric or nonsensical value (negative, or past a human
 * lifespan) is treated as absent rather than rendered as-is.
 */
export function profileAge(profile: UserProfileProps | undefined): string | null {
  const raw = firstProp(profile, AGE_KEYS);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 150) return null;
  return String(parsed);
}

/**
 * The single contact string shown under a person's name: their email, else their phone number,
 * else — when the profile carries neither — the distinct id we know them by.
 */
export function contactLine(profile: UserProfileProps | undefined, distinctId: string): string {
  return profileEmail(profile) ?? profilePhone(profile) ?? distinctId;
}

/**
 * Same fallback as {@link contactLine} for the Users list / command palette, which get `email` and
 * `phone` as already-resolved columns from `GET /users` rather than a raw profile blob.
 */
export function contactFromListItem(user: {
  email: string | null;
  phone: string | null;
  distinct_id: string;
}): string {
  return user.email ?? user.phone ?? user.distinct_id;
}
