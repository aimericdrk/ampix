import { compileDateRange, compileFilterClauses } from './filter-compiler';
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
  return `greatest(0, least(toInt32({${gridParam}:UInt32}) - 1, toInt32(floor(${posExpr} / ${sizeColumn} * {${gridParam}:UInt32}))))`;
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
    'screen_width > 0',
    'screen_height > 0',
    ...compileFilterClauses(query.filters, params),
  ];

  const sql = [
    'SELECT cx, cy, count() AS cnt',
    'FROM (',
    '  SELECT',
    `    ${cellExpr(POS_X_EXPR, 'screen_width', 'cols')} AS cx,`,
    `    ${cellExpr(POS_Y_EXPR, 'screen_height', 'rows')} AS cy`,
    '  FROM events',
    `  WHERE ${whereClauses.join('\n    AND ')}`,
    ')',
    'GROUP BY cx, cy',
    'ORDER BY cy, cx',
  ].join('\n');

  return { sql, params };
}
