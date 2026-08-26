import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ClickHouseClient } from '@clickhouse/client';

/** `infra/clickhouse/init.sql` (shared contracts §5 DDL), resolved from the repo root. */
const INIT_SQL_PATH = path.resolve(__dirname, '../../../../..', 'infra/clickhouse/init.sql');

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
