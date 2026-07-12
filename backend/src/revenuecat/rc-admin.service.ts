import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ProblemException } from '../common/problem-details';
import { RcWebhookProcessor } from './rc-webhook.processor';
import type { RcUpsertInput } from './rc-admin.schema';

export interface RcIntegrationStatus {
  connected: boolean;
  webhook_path: string; // `/webhooks/revenuecat/${projectId}` — UI prefixes apiBaseUrl
  webhook_secret: string; // full value: the admin must paste it into RC
  api_key_masked: string | null; // '…' + last 4, or null
  rc_project_id: string | null;
  sandbox_mode: boolean;
  last_webhook_at: string | null; // ISO
  backfill_status: string | null;
  counts: { processed: number; failed: number; unlinked: number; skipped: number };
}

export interface RcJournalEntry {
  id: string;
  rc_event_id: string;
  event_type: string;
  rc_app_user_id: string | null;
  status: string;
  error: string | null;
  received_at: string;
}

export interface UserSubscription {
  status: string;
  product_id: string | null;
  store: string | null;
  period_type: string | null;
  total_spent_cents: number;
  mrr_cents: number;
  currency: string | null;
  first_purchase_at: string | null;
  expires_at: string | null;
  cancelled_at: string | null;
  rc_app_user_id: string;
  rc_customer_url: string | null; // https://app.revenuecat.com/customers/{rc_project_id}/{urlencoded app_user_id} when rc_project_id set
}

const JOURNAL_STATUSES = ['processed', 'failed', 'unlinked', 'skipped'] as const;

/**
 * RevenueCat integration management API (spec §4.7): connect/disconnect, journal read + replay,
 * and the per-user subscription lookup that powers the profile card. Reads use
 * `ProjectsService.assertMembership` (viewer+); writes are gated admin-only by the controller's
 * `ProjectRolesGuard`.
 */
@Injectable()
export class RcAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly processor: RcWebhookProcessor,
  ) {}

  async getStatus(projectId: string): Promise<RcIntegrationStatus> {
    const row = await this.prisma.revenueCatIntegration.findUnique({ where: { projectId } });
    const webhook_path = `/webhooks/revenuecat/${projectId}`;
    if (row === null) {
      return {
        connected: false,
        webhook_path,
        webhook_secret: '',
        api_key_masked: null,
        rc_project_id: null,
        sandbox_mode: false,
        last_webhook_at: null,
        backfill_status: null,
        counts: { processed: 0, failed: 0, unlinked: 0, skipped: 0 },
      };
    }
    const grouped = await this.prisma.revenueCatWebhookEvent.groupBy({
      by: ['status'],
      where: { projectId },
      _count: { _all: true },
    });
    const counts = { processed: 0, failed: 0, unlinked: 0, skipped: 0 };
    for (const g of grouped) {
      if ((JOURNAL_STATUSES as readonly string[]).includes(g.status)) {
        counts[g.status as (typeof JOURNAL_STATUSES)[number]] = g._count._all;
      }
    }
    return {
      connected: true,
      webhook_path,
      webhook_secret: row.webhookSecret,
      api_key_masked: row.apiKey ? `…${row.apiKey.slice(-4)}` : null,
      rc_project_id: row.rcProjectId,
      sandbox_mode: row.sandboxMode,
      last_webhook_at: row.lastWebhookAt?.toISOString() ?? null,
      backfill_status: row.backfillStatus,
      counts,
    };
  }

  async upsert(projectId: string, input: RcUpsertInput): Promise<RcIntegrationStatus> {
    const update: Record<string, unknown> = {};
    if (input.api_key !== undefined) update.apiKey = input.api_key;
    if (input.rc_project_id !== undefined) update.rcProjectId = input.rc_project_id;
    if (input.sandbox_mode !== undefined) update.sandboxMode = input.sandbox_mode;
    await this.prisma.revenueCatIntegration.upsert({
      where: { projectId },
      create: {
        projectId,
        webhookSecret: `rcwh_${randomBytes(24).toString('hex')}`,
        apiKey: input.api_key ?? null,
        rcProjectId: input.rc_project_id ?? null,
        sandboxMode: input.sandbox_mode ?? false,
      },
      update,
    });
    return this.getStatus(projectId);
  }

  async disconnect(projectId: string): Promise<void> {
    const integration = await this.prisma.revenueCatIntegration.findUnique({ where: { projectId } });
    if (integration === null) throw this.notFound();
    // Config only — SubscriptionState, journal, and CH events are kept (spec §4.7).
    await this.prisma.revenueCatIntegration.delete({ where: { projectId } });
  }

  async listJournal(projectId: string, status?: string): Promise<{ events: RcJournalEntry[] }> {
    const rows = await this.prisma.revenueCatWebhookEvent.findMany({
      where: { projectId, ...(status ? { status } : {}) },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
    return {
      events: rows.map((r) => ({
        id: r.id,
        rc_event_id: r.rcEventId,
        event_type: r.eventType,
        rc_app_user_id: r.rcAppUserId,
        status: r.status,
        error: r.error,
        received_at: r.receivedAt.toISOString(),
      })),
    };
  }

  async replay(projectId: string): Promise<{ replayed: number; remaining: number }> {
    return this.processor.replayUnlinked(projectId);
  }

  async getUserSubscription(
    userId: string,
    projectId: string,
    distinctId: string,
  ): Promise<{ subscription: UserSubscription | null }> {
    await this.projects.assertMembership(userId, projectId);
    const state = await this.prisma.subscriptionState.findFirst({
      where: { projectId, distinctId },
      orderBy: { updatedAt: 'desc' },
    });
    if (state === null) return { subscription: null };
    const integration = await this.prisma.revenueCatIntegration.findUnique({ where: { projectId } });
    const rcProjectId = integration?.rcProjectId ?? null;
    return {
      subscription: {
        status: state.status,
        product_id: state.productId,
        store: state.store,
        period_type: state.periodType,
        total_spent_cents: state.totalSpentCents,
        mrr_cents: state.mrrCents,
        currency: state.currency,
        first_purchase_at: state.firstPurchaseAt?.toISOString() ?? null,
        expires_at: state.expiresAt?.toISOString() ?? null,
        cancelled_at: state.cancelledAt?.toISOString() ?? null,
        rc_app_user_id: state.rcAppUserId,
        rc_customer_url: rcProjectId
          ? `https://app.revenuecat.com/customers/${rcProjectId}/${encodeURIComponent(state.rcAppUserId)}`
          : null,
      },
    };
  }

  private notFound(): ProblemException {
    return new ProblemException({
      status: 404,
      title: 'Not Found',
      detail: 'RevenueCat integration not found',
    });
  }
}
