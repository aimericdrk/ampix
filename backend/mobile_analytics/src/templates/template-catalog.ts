import type { ReportKind } from '../reports/report.schema';

/**
 * Fixed, code-defined template catalog (contracts §19). Each template is an Amplitude-parity bundle
 * of §14/§15 saved-report definitions plus a §16 dashboard layout. Definitions are stored WITHOUT a
 * `date_range` — {@link TemplatesService} injects a default (last 30 days) at apply time so every
 * report validates against its §14/§15 zod schema before it is written. Event names use the SDK's
 * reserved autocapture events (contracts §4: `$first_open`, `$app_open`, `$session_start`,
 * `$screen_view`, `$in_app_purchase`, `$tap`) so a freshly-instrumented app has data for them.
 */

/** A saved report in a bundle: its definition omits `date_range` (merged in at apply time). */
export interface TemplateReportSpec {
  name: string;
  kind: ReportKind;
  /** A §14/§15 definition minus `date_range`. */
  definition: Record<string, unknown>;
}

/** A dashboard tile placement referencing a bundle report by its index. 12-column grid (x+w<=12). */
export interface TemplateTileSpec {
  title: string;
  /** Index into the template's `reports[]`. */
  reportRef: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplateSpec {
  id: string;
  name: string;
  description: string;
  /** The dashboard created on apply; also the idempotency key (skip-if-exists by this name). */
  dashboardName: string;
  reports: TemplateReportSpec[];
  tiles: TemplateTileSpec[];
}

/** Full-width single tile. */
const FULL = { x: 0, y: 0, w: 12, h: 4 };
/** Left / right halves of a 12-column row. */
const LEFT = { x: 0, y: 0, w: 6, h: 4 };
const RIGHT = { x: 6, y: 0, w: 6, h: 4 };

export const TEMPLATE_CATALOG: readonly TemplateSpec[] = Object.freeze([
  {
    id: 'acquisition',
    name: 'Acquisition',
    description: 'New users over time and where they come from.',
    dashboardName: 'Acquisition',
    reports: [
      {
        name: 'New Users',
        kind: 'insights',
        definition: {
          events: [{ name: '$first_open', aggregation: 'unique_users' }],
          interval: 'day',
        },
      },
      {
        name: 'Users by Acquisition Source',
        kind: 'insights',
        definition: {
          events: [{ name: '$app_open', aggregation: 'unique_users' }],
          interval: 'day',
          breakdown: { property: 'utm_source' },
        },
      },
    ],
    tiles: [
      { title: 'New Users', reportRef: 0, ...LEFT },
      { title: 'Users by Acquisition Source', reportRef: 1, ...RIGHT },
    ],
  },
  {
    id: 'activation-funnel',
    name: 'Activation Funnel',
    description: 'First-open → first screen → first purchase conversion.',
    dashboardName: 'Activation Funnel',
    reports: [
      {
        name: 'Activation Funnel',
        kind: 'funnel',
        definition: {
          steps: [
            { event: '$first_open' },
            { event: '$screen_view' },
            { event: '$in_app_purchase' },
          ],
          window_days: 7,
        },
      },
    ],
    tiles: [{ title: 'Activation Funnel', reportRef: 0, ...FULL }],
  },
  {
    id: 'engagement',
    name: 'Engagement',
    description: 'Active users and sessions over time.',
    dashboardName: 'Engagement',
    reports: [
      {
        name: 'Active Users',
        kind: 'insights',
        definition: {
          events: [{ name: '$app_open', aggregation: 'unique_users' }],
          interval: 'day',
        },
      },
      {
        name: 'Sessions',
        kind: 'insights',
        definition: {
          events: [{ name: '$session_start', aggregation: 'total' }],
          interval: 'day',
        },
      },
    ],
    tiles: [
      { title: 'Active Users', reportRef: 0, ...LEFT },
      { title: 'Sessions', reportRef: 1, ...RIGHT },
    ],
  },
  {
    id: 'retention',
    name: 'Retention',
    description: 'How many new users return in the following days.',
    dashboardName: 'Retention',
    reports: [
      {
        name: 'New User Retention',
        kind: 'retention',
        definition: {
          born_event: { name: '$first_open' },
          return_event: { name: '$app_open' },
          interval: 'day',
          periods: 14,
        },
      },
    ],
    tiles: [{ title: 'New User Retention', reportRef: 0, ...FULL }],
  },
  {
    id: 'revenue',
    name: 'Revenue',
    description: 'Purchases and paying users over time.',
    dashboardName: 'Revenue',
    reports: [
      {
        name: 'Purchases',
        kind: 'insights',
        definition: {
          events: [{ name: '$in_app_purchase', aggregation: 'total' }],
          interval: 'day',
        },
      },
      {
        name: 'Paying Users',
        kind: 'insights',
        definition: {
          events: [{ name: '$in_app_purchase', aggregation: 'unique_users' }],
          interval: 'day',
        },
      },
    ],
    tiles: [
      { title: 'Purchases', reportRef: 0, ...LEFT },
      { title: 'Paying Users', reportRef: 1, ...RIGHT },
    ],
  },
  {
    id: 'product-usage',
    name: 'Product Usage',
    description: 'Screen views by screen and tap volume.',
    dashboardName: 'Product Usage',
    reports: [
      {
        name: 'Screen Views by Screen',
        kind: 'insights',
        definition: {
          events: [{ name: '$screen_view', aggregation: 'total' }],
          interval: 'day',
          breakdown: { property: '$screen_name' },
        },
      },
      {
        name: 'Taps',
        kind: 'insights',
        definition: {
          events: [{ name: '$tap', aggregation: 'total' }],
          interval: 'day',
        },
      },
    ],
    tiles: [
      { title: 'Screen Views by Screen', reportRef: 0, ...LEFT },
      { title: 'Taps', reportRef: 1, ...RIGHT },
    ],
  },
  {
    id: 'user-paths',
    name: 'User Paths',
    description: 'Where users go after opening the app.',
    dashboardName: 'User Paths',
    reports: [
      {
        name: 'Paths from App Open',
        kind: 'flows',
        definition: {
          anchor: { event: '$app_open' },
          direction: 'forward',
          steps: 3,
          max_nodes_per_step: 8,
          unit: 'session',
        },
      },
    ],
    tiles: [{ title: 'Paths from App Open', reportRef: 0, ...FULL }],
  },
]);

/** Looks up a template spec by id (undefined when unknown). */
export function findTemplate(templateId: string): TemplateSpec | undefined {
  return TEMPLATE_CATALOG.find((template) => template.id === templateId);
}

/** Counts a bundle's saved reports by kind (contracts §19 `kind_counts`). */
export function kindCounts(spec: TemplateSpec): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const report of spec.reports) {
    counts[report.kind] = (counts[report.kind] ?? 0) + 1;
  }
  return counts;
}
