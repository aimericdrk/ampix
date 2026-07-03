import { Injectable } from '@nestjs/common';
import type { ProfileOperation } from '@myampmix/contracts';
import { ClickHouseService, ProfileRow, toChDateTime64 } from '../clickhouse/clickhouse.service';

/** Pure profile-op semantics (contracts §4). Never mutates `current`. */
export function applyOperation(
  current: Record<string, unknown>,
  op: ProfileOperation,
): Record<string, unknown> {
  const props = op.properties ?? {};
  switch (op.op) {
    case 'set':
      return { ...current, ...props };
    case 'set_once': {
      const next = { ...current };
      for (const [key, value] of Object.entries(props)) {
        if (!(key in next)) next[key] = value;
      }
      return next;
    }
    case 'increment': {
      const next = { ...current };
      for (const [key, value] of Object.entries(props)) {
        const delta = typeof value === 'number' ? value : 0;
        const base = typeof next[key] === 'number' ? (next[key] as number) : 0;
        next[key] = base + delta;
      }
      return next;
    }
    case 'append': {
      const next = { ...current };
      for (const [key, value] of Object.entries(props)) {
        const base = Array.isArray(next[key]) ? (next[key] as unknown[]) : [];
        next[key] = [...base, value];
      }
      return next;
    }
    case 'unset': {
      const next = { ...current };
      for (const key of Object.keys(props)) {
        delete next[key];
      }
      return next;
    }
    case 'delete':
      return {};
  }
}

/**
 * Applies profile operations: read current state (SELECT ... FINAL), fold ops in
 * timestamp order, write one new user_profiles row per user. ReplacingMergeTree(updated_at)
 * keeps the latest row; profile ops are rare relative to events, so the read is acceptable.
 *
 * Concurrency: this is a read-fold-write without locking. Concurrent requests mutating
 * the same distinct_id each read the same base state and write competing full rows;
 * ReplacingMergeTree keeps the one with the latest updated_at (last write wins), so a
 * concurrent request's ops can be discarded entirely — not merged. Acceptable under the
 * design's eventual-consistency model for profile data.
 */
@Injectable()
export class ProfileWriter {
  constructor(private readonly clickhouse: ClickHouseService) {}

  async apply(
    projectId: string,
    operations: ProfileOperation[],
    nowMs: number = Date.now(),
  ): Promise<void> {
    if (operations.length === 0) return;

    const byUser = new Map<string, ProfileOperation[]>();
    for (const operation of operations) {
      const list = byUser.get(operation.distinct_id) ?? [];
      list.push(operation);
      byUser.set(operation.distinct_id, list);
    }

    const rows: ProfileRow[] = [];
    for (const [distinctId, ops] of byUser) {
      let properties = (await this.fetchCurrent(projectId, distinctId)) ?? {};
      const ordered = [...ops].sort((a, b) => a.timestamp - b.timestamp);
      for (const operation of ordered) {
        properties = applyOperation(properties, operation);
      }
      rows.push({
        project_id: projectId,
        distinct_id: distinctId,
        properties,
        updated_at: toChDateTime64(nowMs),
      });
    }
    await this.clickhouse.insertProfiles(rows);
  }

  private async fetchCurrent(
    projectId: string,
    distinctId: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await this.clickhouse.query<{ properties: Record<string, unknown> }>(
      'SELECT properties FROM user_profiles FINAL WHERE project_id = {projectId:UUID} AND distinct_id = {distinctId:String} LIMIT 1',
      { projectId, distinctId },
      // ClickHouse 24.8's JSON type infers integer leaves as Int64 and, by default,
      // quotes 64-bit integers as JSON strings (precision-loss guard for JS numbers).
      // A stringified base would make applyOperation's increment silently reset to the
      // delta, so opt out of the quoting for this read specifically.
      { output_format_json_quote_64bit_integers: 0 },
    );
    return rows[0]?.properties ?? null;
  }
}
