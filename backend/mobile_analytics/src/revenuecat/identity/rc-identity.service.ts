import { Injectable } from '@nestjs/common';
import { ClickHouseService } from '../../clickhouse/clickhouse.service';

/**
 * Maps a RevenueCat app_user_id to a MyAmpix distinct_id (spec §4.4).
 * Order: explicit $rc_link event > identity_mappings canonical > raw distinct_id presence.
 * $RCAnonymousID:* ids only ever resolve via the explicit link.
 */
@Injectable()
export class RcIdentityService {
  constructor(private readonly clickhouse: ClickHouseService) {}

  async resolveDistinctId(projectId: string, appUserId: string): Promise<string | null> {
    const linked = await this.clickhouse.query<{ distinct_id: string }>(
      `SELECT distinct_id
       FROM events
       WHERE project_id = {projectId:UUID}
         AND event = '$rc_link'
         AND JSONExtractString(toJSONString(properties), '$rc_app_user_id') = {appUserId:String}
       ORDER BY timestamp DESC
       LIMIT 1`,
      { projectId, appUserId },
    );
    if (linked.length > 0) return linked[0].distinct_id;

    if (appUserId.startsWith('$RCAnonymousID:')) return null;

    const canonical = await this.clickhouse.query<{ canonical_id: string }>(
      `SELECT argMax(canonical_id, created_at) AS canonical_id
       FROM identity_mappings
       WHERE project_id = {projectId:UUID} AND anon_id = {appUserId:String}
       GROUP BY anon_id`,
      { projectId, appUserId },
    );
    if (canonical.length > 0 && canonical[0].canonical_id) return canonical[0].canonical_id;

    const present = await this.clickhouse.query<{ one: number }>(
      `SELECT 1 AS one
       FROM events
       WHERE project_id = {projectId:UUID} AND distinct_id = {appUserId:String}
       LIMIT 1`,
      { projectId, appUserId },
    );
    return present.length > 0 ? appUserId : null;
  }
}
