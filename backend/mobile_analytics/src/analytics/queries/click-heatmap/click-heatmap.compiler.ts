import { compileDateRange, compileFilterClauses } from '../../support/filter-compiler';
import type { ClickHeatmapQuery } from './click-heatmap.schema';

/**
 * Click-heatmap compiler (contracts §19). Over `$tap` autocapture events for a single `$screen_name`,
 * normalizes each tap to `[0,1]²` via `$pos_x / screen_width`, `$pos_y / screen_height` (the context
 * columns), buckets into a `cols×rows` grid, and `count()`s per cell.
 *
 * SECURITY: `$tap` / `$screen_name` / `$pos_x` / `$pos_y` are OUR fixed reserved autocapture constants
 * (contracts §4) — embedded as SQL literals exactly like §14's `$session_end`, never bound from user
 * input. Every caller-supplied value — the target `screen_name`, the grid dimensions, and every filter
 * key/value — is a bound `query_param`. `screen_width`/`screen_height` are whitelisted event columns.
 */

/** The tap autocapture event name (contracts §4) — OUR reserved constant, an SQL literal. */
export const TAP_EVENT = '$tap';
/** `$screen_name` / `$pos_x` / `$pos_y` are reserved `$tap` properties (contracts §4); extracted from
 *  the native JSON column via `toJSONString(properties)` first (see property-resolver's note). */
const SCREEN_NAME_EXPR = "JSONExtractString(toJSONString(properties), '$screen_name')";
const POS_X_EXPR = "JSONExtractFloat(toJSONString(properties), '$pos_x')";
const POS_Y_EXPR = "JSONExtractFloat(toJSONString(properties), '$pos_y')";
/**
 * Content-space geometry, emitted by the SDK only when the tap landed inside a vertical scrollable
 * that actually scrolls (see the Flutter tracker's `_resolveScrollGeometry`). `$content_y` is the
 * tap's position in the page's FULL content; `$pos_y` is its position in the visible viewport.
 */
const CONTENT_Y_EXPR = "JSONExtractFloat(toJSONString(properties), '$content_y')";
const CONTENT_HEIGHT_EXPR = "JSONExtractFloat(toJSONString(properties), '$content_height')";

/**
 * The vertical position of a tap as a `[0,1]` fraction of whatever it should be measured against.
 *
 * Two shapes coexist and will for a long time. A tap from an SDK that records scroll geometry is
 * normalized against the page's content height, which is what makes it placeable on a full-page
 * screenshot: on a scrollable screen `$pos_y` alone is meaningless, because the same content sits
 * at a different `$pos_y` depending on how far the user had scrolled. A tap without it — every
 * event collected before that SDK, and every event from a user on an older build — falls back to
 * the original viewport normalization, which is exactly as correct as it ever was.
 *
 * The fallback is not a transitional convenience: an SDK change only reaches users through an
 * app-store release, so both shapes arrive concurrently for months, and a screen that does not
 * scroll never emits the content-space properties at all.
 */
const VERTICAL_FRACTION_EXPR = `if(${CONTENT_HEIGHT_EXPR} > 0, ${CONTENT_Y_EXPR} / ${CONTENT_HEIGHT_EXPR}, ${POS_Y_EXPR} / screen_height)`;

export interface CompiledHeatmapQuery {
  sql: string;
  params: Record<string, unknown>;
}

/**
 * Clamped cell index for one axis: `clamp(floor(pos / size * n), 0, n-1)`. `greatest(0, …)` and
 * `least(n-1, …)` fold any out-of-bounds tap — including an exact bottom/right-edge tap that
 * normalizes to `1.0` — into the last valid cell rather than overflowing the grid.
 */
function cellExpr(posExpr: string, sizeColumn: string, gridParam: string): string {
  return fractionCellExpr(`${posExpr} / ${sizeColumn}`, gridParam);
}

/** The same clamp, over an already-normalized `[0,1]` fraction. */
function fractionCellExpr(fractionExpr: string, gridParam: string): string {
  return `greatest(0, least(toInt32({${gridParam}:UInt32}) - 1, toInt32(floor((${fractionExpr}) * {${gridParam}:UInt32}))))`;
}

/**
 * Compiles a validated {@link ClickHeatmapQuery} into one fully-parameterized ClickHouse query
 * (contracts §19). Pure: it never touches ClickHouse. Rows with a `0` screen dimension are skipped
 * (they cannot be normalized). The outer query groups by `(cx, cy)` so empty cells are simply absent.
 */
export function compileClickHeatmapQuery(
  query: ClickHeatmapQuery,
  projectId: string,
): CompiledHeatmapQuery {
  const params: Record<string, unknown> = {
    projectId,
    screen: query.screen_name,
    cols: query.grid.cols,
    rows: query.grid.rows,
    ...compileDateRange(query.date_range.from, query.date_range.to),
  };

  const whereClauses = [
    'project_id = {projectId:UUID}',
    `event = '${TAP_EVENT}'`,
    `${SCREEN_NAME_EXPR} = {screen:String}`,
    'timestamp >= {from:DateTime64}',
    'timestamp < {toExclusive:DateTime64}',
    // x is always viewport-relative: pages scroll vertically, so `$pos_x` needs no correction.
    'screen_width > 0',
    // y is normalizable by EITHER measure, so requiring a screen height would drop a tap that
    // carries its own page geometry — the ones that are most placeable.
    `(${CONTENT_HEIGHT_EXPR} > 0 OR screen_height > 0)`,
    ...compileFilterClauses(query.filters, params),
  ];

  // §17 identity-correct per-user filter: the caller passes the canonical id + its aliased anon_ids
  // and we restrict to those exact RAW `distinct_id` values. The raw column is deliberately NOT
  // canonicalized here (contracts §17: the heatmap filters the raw column), so a user tracked
  // anonymously then identified — whose taps live under BOTH ids — is fully captured. The list is
  // bound as an Array(String) query_param, so it is injection-safe regardless of the ids' contents.
  if (query.distinct_ids && query.distinct_ids.length > 0) {
    whereClauses.push('distinct_id IN {distinctIds:Array(String)}');
    params.distinctIds = query.distinct_ids;
  }

  const sql = [
    'SELECT cx, cy, count() AS cnt',
    'FROM (',
    '  SELECT',
    `    ${cellExpr(POS_X_EXPR, 'screen_width', 'cols')} AS cx,`,
    `    ${fractionCellExpr(VERTICAL_FRACTION_EXPR, 'rows')} AS cy`,
    '  FROM events',
    `  WHERE ${whereClauses.join('\n    AND ')}`,
    ')',
    'GROUP BY cx, cy',
    'ORDER BY cy, cx',
  ].join('\n');

  return { sql, params };
}
