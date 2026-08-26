import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ClickHouseClient } from '@clickhouse/client';

const INIT_SQL_RELATIVE = 'infra/clickhouse/init.sql';

/**
 * `infra/clickhouse/init.sql` (shared contracts §5 DDL), found by walking up from this file until
 * the repo root turns up. A fixed `../../../..` was used here before and silently broke the moment
 * the backend moved down a directory (1a6f5fb) — every suite that applies the schema failed with
 * ENOENT on a path that no longer existed. Searching upward cannot rot that way.
 */
function findInitSql(): string {
  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, INIT_SQL_RELATIVE);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`could not locate ${INIT_SQL_RELATIVE} in any ancestor of ${__dirname}`);
    }
    dir = parent;
  }
}

const INIT_SQL_PATH = findInitSql();

function isCommentOrBlankLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith('--');
}

/** Splits a `.sql` file into individual statements on `;`, dropping empty/comment-only fragments. */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(
      (statement) => statement.length > 0 && !statement.split('\n').every(isCommentOrBlankLine),
    );
}

/**
 * Applies the exact same DDL the production ClickHouse container runs on first boot
 * (`infra/clickhouse/init.sql`) to a Testcontainers instance, statement by statement.
 */
export async function applyClickHouseSchema(client: ClickHouseClient): Promise<void> {
  const sql = readFileSync(INIT_SQL_PATH, 'utf-8');
  for (const statement of splitSqlStatements(sql)) {
    await client.command({
      query: statement,
      clickhouse_settings: { allow_experimental_json_type: 1 },
    });
  }
}
