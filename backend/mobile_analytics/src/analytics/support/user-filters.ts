import { z } from 'zod';
import { ProblemException } from '../../common/problem-details';
import { FILTER_OPS, filterValueSchema } from '../queries/insights/insights-query.schema';
import { profilePropertyPredicate } from './filter-compiler';
import {
  USER_EMAIL_PROFILE_KEYS,
  USER_PHONE_PROFILE_KEYS,
} from '../services/analytics.shared';

/**
 * The audience list's filters (`GET /users`): the profile properties an operator narrows the Users
 * page by — age, gender, city, plan, anything an app has ever set through `people.set` — plus the
 * identity switch that separates the people you can contact from the ids you cannot.
 *
 * INJECTION SAFETY: same doctrine as the cohort engine. A filter's PROPERTY NAME is bound as a
 * `{…Key:String}` param inside `JSONExtractString(toJSONString(properties), {key})` and its VALUE
 * as a second param — neither is ever concatenated into SQL. The only fixed text this module emits
 * is its own subquery skeleton and the operator mapping inside `profilePropertyPredicate`, which
 * is selected by an already-validated enum.
 */

/** A single audience filter. `target` is implicit: this endpoint filters profiles, nothing else. */
export const userFilterSchema = z
  .object({
    property: z.string().trim().min(1).max(255),
    op: z.enum(FILTER_OPS),
    value: filterValueSchema.optional(),
  })
  .refine(
    (filter) => filter.op === 'is_set' || filter.op === 'is_not_set' || filter.value !== undefined,
    { message: 'value is required for this operator', path: ['value'] },
  );
export type UserFilter = z.infer<typeof userFilterSchema>;

/** A bound on how much WHERE clause one request can grow — defense in depth, as in §14. */
const MAX_USER_FILTERS = 10;
const userFiltersSchema = z.array(userFilterSchema).max(MAX_USER_FILTERS);

/**
 * Who the list shows. `identified` is "we can CONTACT this person" — their profile carries an email
 * or a phone number; `anonymous` is its exact complement. Any other profile property (a city, an
 * age, a plan) does not make someone identified: knowing that a user id is 34 and in Paris still
 * leaves you with an id, which is exactly the row an operator is trying to filter out.
 *
 * Note this is about PROFILE data, not about the SDK's anon_id: a backend-written user id with no
 * `people.set` behind it is anonymous here, however real the person is.
 */
export const USER_IDENTITY_FILTERS = ['all', 'identified', 'anonymous'] as const;
export type UserIdentityFilter = (typeof USER_IDENTITY_FILTERS)[number];

/** `?filters=<json>` — parsed and validated, or a 400 that says which part was wrong. */
export function parseUserFilters(raw: string | undefined): UserFilter[] {
  if (raw === undefined || raw.trim() === '') return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new ProblemException({
      status: 400,
      title: 'Bad Request',
      detail: 'filters must be a JSON array of {property, op, value}',
    });
  }
  const parsed = userFiltersSchema.safeParse(decoded);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ProblemException({
      status: 400,
      title: 'Bad Request',
      detail: `filters: ${issue.path.join('.') || 'item'} ${issue.message}`,
    });
  }
  return parsed.data;
}

/** `?identity=` — anything but the three known values is a 400 rather than a silent "all". */
export function parseUserIdentityFilter(raw: string | undefined): UserIdentityFilter {
  if (raw === undefined || raw.trim() === '') return 'all';
  const parsed = z.enum(USER_IDENTITY_FILTERS).safeParse(raw.trim());
  if (!parsed.success) {
    throw new ProblemException({
      status: 400,
      title: 'Bad Request',
      detail: `identity must be one of ${USER_IDENTITY_FILTERS.join(', ')}`,
    });
  }
  return parsed.data;
}

/**
 * `<key> != '' OR …` over the accepted spellings of one contact field. The keys are OUR OWN fixed
 * constants (analytics.shared.ts), embedded as SQL literals exactly as the search whitelist is —
 * never caller input.
 */
function anyKeySet(keys: readonly string[]): string {
  return keys
    .map((key) => `JSONExtractString(toJSONString(properties), '${key}') != ''`)
    .join('\n              OR ');
}

/** The SQL definition of "we can reach this person": an email or a phone number on their profile. */
const HAS_CONTACT_SUBQUERY = `SELECT distinct_id FROM user_profiles FINAL
       WHERE project_id = {projectId:UUID}
         AND (${anyKeySet([...USER_EMAIL_PROFILE_KEYS, ...USER_PHONE_PROFILE_KEYS])})`;

/**
 * The WHERE clauses for one request's filters, each as `<uid> IN (<profile subquery>)`.
 *
 * `uidExpr` is always the CALLER'S OWN canonicalization expression (never input), so a filter
 * applies to the merged person rather than to whichever of their ids happens to hold the profile.
 * Every property name and value binds as a param; `params` is mutated with those bindings.
 */
export function compileUserFilters(
  filters: UserFilter[],
  uidExpr: string,
  params: Record<string, unknown>,
): string[] {
  return filters.map((filter, index) => {
    const keyParam = `userFilterKey${index}`;
    const valueParam = `userFilterVal${index}`;
    params[keyParam] = filter.property;
    const expr = `JSONExtractString(toJSONString(properties), {${keyParam}:String})`;
    const predicate = profilePropertyPredicate(expr, filter.op, filter.value, valueParam, params);
    return `${uidExpr} IN (
         SELECT distinct_id FROM user_profiles FINAL
         WHERE project_id = {projectId:UUID} AND ${predicate}
       )`;
  });
}

/** The identity switch's clause, or '' for `all` (which is simply no clause at all). */
export function compileUserIdentityFilter(identity: UserIdentityFilter, uidExpr: string): string {
  if (identity === 'all') return '';
  const membership = identity === 'identified' ? 'IN' : 'NOT IN';
  return `${uidExpr} ${membership} (
         ${HAS_CONTACT_SUBQUERY}
       )`;
}
