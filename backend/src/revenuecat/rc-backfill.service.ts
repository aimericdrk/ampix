import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileWriter } from '../ingestion/profile-writer';
import { RcApiClient, RcApiSubscription } from './rc-api.client';
import { RcIdentityService } from './rc-identity.service';
import { profileOpsFor } from './rc-event-mapper';

/** RC API status → our status (spec §4.6; state only, never CH events). */
function mapApiStatus(sub: RcApiSubscription): 'trial' | 'active' | 'grace' | 'paused' | 'churned' {
  switch (sub.status) {
    case 'trialing': return 'trial';
    case 'active': return 'active';
    case 'in_grace_period': case 'in_billing_retry': return 'grace';
    case 'paused': return 'paused';
    default: return sub.gives_access ? 'active' : 'churned';
  }
}

@Injectable()
export class RcBackfillService {
  private readonly logger = new Logger(RcBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: RcApiClient,
    private readonly identity: RcIdentityService,
    private readonly profileWriter: ProfileWriter,
  ) {}

  async run(projectId: string, nowMs = Date.now()): Promise<void> {
    const integration = await this.prisma.revenueCatIntegration.findUnique({ where: { projectId } });
    if (!integration) return;
    if (!integration.apiKey || !integration.rcProjectId) {
      await this.setStatus(projectId, 'failed: missing credentials');
      return;
    }
    await this.setStatus(projectId, 'running');
    try {
      for await (const customers of this.client.listCustomers(integration.apiKey, integration.rcProjectId)) {
        for (const customer of customers) {
          await this.syncCustomer(projectId, integration.apiKey, integration.rcProjectId, customer.id, nowMs);
        }
      }
      await this.setStatus(projectId, 'done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`backfill failed for ${projectId}: ${msg}`);
      await this.setStatus(projectId, `failed: ${msg}`.slice(0, 500));
    }
  }

  /** Also used by the per-user refresh endpoint. */
  async syncCustomer(
    projectId: string,
    apiKey: string,
    rcProjectId: string,
    rcAppUserId: string,
    nowMs = Date.now(),
  ): Promise<void> {
    const subs = await this.client.getSubscriptions(apiKey, rcProjectId, rcAppUserId);
    if (subs.length === 0) return;
    const current = subs.find((s) => s.gives_access) ?? subs[0];
    const distinctId = await this.identity.resolveDistinctId(projectId, rcAppUserId);
    const state = await this.prisma.subscriptionState.upsert({
      where: { projectId_rcAppUserId: { projectId, rcAppUserId } },
      create: {
        projectId, rcAppUserId, distinctId,
        status: mapApiStatus(current),
        productId: current.product_id, store: current.store, periodType: null,
        priceCents: null, currency: 'USD',
        mrrCents: 0,
        totalSpentCents: Math.round((current.total_revenue_in_usd?.gross ?? 0) * 100),
        firstPurchaseAt: null,
        expiresAt: current.current_period_ends_at ? new Date(current.current_period_ends_at) : null,
        cancelledAt: null, lastEventAt: new Date(nowMs),
      },
      update: {
        ...(distinctId !== null ? { distinctId } : {}),
        status: mapApiStatus(current),
        productId: current.product_id, store: current.store,
        expiresAt: current.current_period_ends_at ? new Date(current.current_period_ends_at) : null,
        lastEventAt: new Date(nowMs),
      },
    });
    if (distinctId !== null) {
      await this.profileWriter.apply(projectId, profileOpsFor(distinctId, state, nowMs), nowMs);
    }
  }

  private async setStatus(projectId: string, backfillStatus: string): Promise<void> {
    await this.prisma.revenueCatIntegration.update({ where: { projectId }, data: { backfillStatus } });
  }
}
