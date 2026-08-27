import { compileDateRange, compileFilterClauses } from '../../support/filter-compiler';
import { TAP_EVENT } from '../click-heatmap/click-heatmap.compiler';
import type { TapElementsQuery } from './tap-elements.schema';

/**
 * Compiles a {@link TapElementsQuery} into one fully-parameterized ClickHouse query: the `$tap`
 * events on one screen, ranked by what was tapped.
 *
 * This is the answer for screens taller than the viewport. `$pos_x`/`$pos_y` are recorded in
 * VIEWPORT coordinates with no scroll offset, so on a scrollable screen every scroll position
 * collapses onto the same band of a heatmap and the taps cannot be placed against a reference
 * screenshot. The widget identity carries no such assumption: it is exact wherever the element
 * happened to be on screen.
 *
 * SECURITY: `$tap`, `$screen_name`, `$widget_type` and `$widget_label` are OUR fixed reserved
 * autocapture constants (contracts §4), embedded as literals exactly as the click-heatmap compiler
 * embeds its own. Every caller-supplied value — the screen, the limit, the filters, the identity
 * set — is a bound query_param.
 */

const SCREEN_NAME_EXPR = "JSONExtractString(toJSONString(properties), '$screen_name')";
const WIDGET_TYPE_EXPR = "JSONExtractString(toJSONString(properties), '$widget_type')";
const WIDGET_LABEL_EXPR = "JSONExtractString(toJSONString(properties), '$widget_label')";

export interface CompiledTapElementsQuery {
  sql: string;
  params: Record<string, unknown>;
}

export function compileTapElementsQuery(
  query: TapElementsQuery,
  projectId: string,
): CompiledTapElementsQuery {
  const params: Record<string, unknown> = {
    projectId,
    screen: query.screen_name,
    limit: query.limit,
    ...compileDateRange(query.date_range.from, query.date_range.to),
  };

  const whereClauses = [
    'project_id = {projectId:UUID}',
    `event = '${TAP_EVENT}'`,
    `${SCREEN_NAME_EXPR} = {screen:String}`,
    'timestamp >= {from:DateTime64}',
    'timestamp < {toExclusive:DateTime64}',
    ...compileFilterClauses(query.filters, params),
  ];

  // Identical to the click-heatmap's §17 handling: the RAW distinct_id column, deliberately not
  // canonicalized, so a user tracked anonymously and then identified is fully captured.
  if (query.distinct_ids && query.distinct_ids.length > 0) {
    whereClauses.push('distinct_id IN {distinctIds:Array(String)}');
    params.distinctIds = query.distinct_ids;
  }

  // Unlabelled taps are counted, not dropped: a screen whose taps mostly land on unidentified
  // widgets is itself the finding, and silently hiding them would overstate the ranked ones.
  const sql = [
    'SELECT widget_type, widget_label, count() AS cnt, uniqExact(distinct_id) AS users',
    'FROM (',
    '  SELECT',
    `    ${WIDGET_TYPE_EXPR} AS widget_type,`,
    `    ${WIDGET_LABEL_EXPR} AS widget_label,`,
    '    distinct_id',
    '  FROM events',
    `  WHERE ${whereClauses.join('\n    AND ')}`,
    ')',
    'GROUP BY widget_type, widget_label',
    'ORDER BY cnt DESC, widget_type, widget_label',
    'LIMIT {limit:UInt32}',
  ].join('\n');

  return { sql, params };
}
