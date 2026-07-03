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
    );
    return rows[0]?.properties ?? null;
  }
}
