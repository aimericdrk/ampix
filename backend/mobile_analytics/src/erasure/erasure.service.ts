import { Injectable, Logger } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { PrismaService } from '../prisma/prisma.service';

/** What one erasure actually removed — returned to the caller for auditability. */
export interface ErasureResult {
  /** Every id erased: the requested distinct_id plus linked anon/canonical ids. */
  ids: string[];
  subscriptionStates: number;
  revenueCatWebhookEvents: number;
}

/**
 * End-user data erasure (account deletion / GDPR). One physical user can be known under several
 * ids (contracts §17): the pre-login anon_id(s) and the post-login canonical id, linked via
 * `identity_mappings`. Erasing only the requested id would leave the user's pre-login events
 * behind, so the id set is expanded through the mapping table (both directions) first, then every
 * store keyed by an end-user id is cleared: ClickHouse events / user_profiles / identity_mappings
 * (see ClickHouseService.deleteUserData) and the Postgres RevenueCat mirrors (subscription_states,
 * revenuecat_webhook_events — rc_app_user_id shares the same id space per the SDK identity
 * bridge, `Purchases.logIn(<same user id>)`).
 */
@Injectable()
export class ErasureService {
  private readonly logger = new Logger(ErasureService.name);

  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly prisma: PrismaService,
  ) {}

  async erase(projectId: string, distinctId: string): Promise<ErasureResult> {
    const related = await this.clickhouse.query<{ id: string }>(
      `SELECT anon_id AS id FROM identity_mappings
       WHERE project_id = {projectId:UUID} AND canonical_id = {distinctId:String}
       UNION DISTINCT
       SELECT canonical_id AS id FROM identity_mappings
       WHERE project_id = {projectId:UUID} AND anon_id = {distinctId:String}`,
      { projectId, distinctId },
    );
    const ids = [
      ...new Set([distinctId, ...related.map((row) => row.id).filter((id) => id.length > 0)]),
    ];

    await this.clickhouse.deleteUserData(projectId, ids);

    const subscriptionStates = await this.prisma.subscriptionState.deleteMany({
      where: { projectId, OR: [{ distinctId: { in: ids } }, { rcAppUserId: { in: ids } }] },
    });
    const webhookEvents = await this.prisma.revenueCatWebhookEvent.deleteMany({
      where: { projectId, rcAppUserId: { in: ids } },
    });

    this.logger.log(
      `erased user data: project=${projectId} ids=${ids.length} subscriptionStates=${subscriptionStates.count} rcWebhookEvents=${webhookEvents.count}`,
    );
    return {
      ids,
      subscriptionStates: subscriptionStates.count,
      revenueCatWebhookEvents: webhookEvents.count,
    };
  }
}
