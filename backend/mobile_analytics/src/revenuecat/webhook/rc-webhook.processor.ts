import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClickHouseService } from '../../clickhouse/clickhouse.service';
import { ProfileWriter } from '../../ingestion/profile-writer';
import { RcIdentityService } from '../identity/rc-identity.service';
import { rcWebhookBodySchema, RcWebhookEvent } from './rc-webhook.schema';
import { deriveStatePatch, profileOpsFor, rcEventName, toEventRow } from '../mapping/rc-event-mapper';

export interface RcIntegrationRef {
  id: string;
  projectId: string;
  sandboxMode: boolean;
}

type JournalStatus = 'processed' | 'failed' | 'unlinked' | 'skipped';

/**
 * Journal-first webhook processing (spec §4.2): every accepted payload lands in
 * revenuecat_webhook_events before any side effect; failures never bubble to RC
 * (we own retries via replay), only unparseable bodies 400.
 */
@Injectable()
export class RcWebhookProcessor {
  private readonly logger = new Logger(RcWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
    private readonly profileWriter: ProfileWriter,
    private readonly identity: RcIdentityService,
  ) {}

  async process(integration: RcIntegrationRef, body: unknown, nowMs = Date.now()): Promise<void> {
    const parsed = rcWebhookBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('unrecognized RevenueCat webhook payload');
    }
    const ev = parsed.data.event;

    let journal;
    try {
      journal = await this.prisma.revenueCatWebhookEvent.create({
        data: {
          projectId: integration.projectId,
          rcEventId: ev.id,
          eventType: ev.type,
          rcAppUserId: ev.app_user_id,
          payload: parsed.data as object,
          status: 'failed', // fail-safe provisional: a throw before finalization below leaves a replayable "failed" row, never a false "processed"
          error: 'processing did not complete',
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return; // duplicate delivery — idempotent no-op
      // journal-first: we couldn't record the payload at all, so propagate — the controller 500s and RC retries (no journal row → don't ack).
      throw err;
    }

    const { status, error } = await this.handle(integration, ev, nowMs);
    try {
      await this.prisma.revenueCatWebhookEvent.update({
        where: { id: journal.id },
        data: { status, error: error ?? null, processedAt: new Date(nowMs) },
      });
      await this.prisma.revenueCatIntegration.update({
        where: { id: integration.id },
        data: { lastWebhookAt: new Date(nowMs) },
      });

      if (status === 'processed') {
        // A successful resolution may unblock earlier webhook-before-link deliveries.
        await this.replayUnlinked(integration.projectId, ev.app_user_id, nowMs);
      }
    } catch (err) {
      // payload is already journaled — ack the webhook and rely on replay rather than leaking this failure to RC.
      this.logger.error(
        `process() post-journal bookkeeping failed for event ${ev.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Replays journal rows still awaiting a successful outcome — both 'unlinked' (no identity yet) and 'failed' (errored) rows. */
  async replayUnlinked(
    projectId: string,
    rcAppUserId?: string,
    nowMs = Date.now(),
  ): Promise<{ replayed: number; remaining: number }> {
    const rows = await this.prisma.revenueCatWebhookEvent.findMany({
      where: { projectId, status: { in: ['unlinked', 'failed'] }, rcAppUserId },
      orderBy: { receivedAt: 'asc' },
      take: 200,
    });
    let replayed = 0;
    for (const row of rows) {
      const ev = (row.payload as { event: RcWebhookEvent }).event;
      const { status, error } = await this.handle(
        { id: '', projectId, sandboxMode: true },
        ev,
        nowMs,
      );
      if (status === 'processed') replayed += 1;
      try {
        await this.prisma.revenueCatWebhookEvent.update({
          where: { id: row.id },
          data: { status, error: error ?? null, processedAt: new Date(nowMs) },
        });
      } catch (err) {
        // one row's bookkeeping failure must not abort the rest of the batch.
        this.logger.error(
          `replayUnlinked: journal update failed for row ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const remaining = await this.prisma.revenueCatWebhookEvent.count({
      where: { projectId, status: { in: ['unlinked', 'failed'] }, ...(rcAppUserId ? { rcAppUserId } : {}) },
    });
    return { replayed, remaining };
  }

  private async handle(
    integration: RcIntegrationRef,
    ev: RcWebhookEvent,
    nowMs: number,
  ): Promise<{ status: JournalStatus; error?: string }> {
    try {
      if (ev.environment === 'SANDBOX' && !integration.sandboxMode) {
        return { status: 'skipped' };
      }
      const eventName = rcEventName(ev.type);
      if (eventName === null) return { status: 'processed' }; // TEST / unknown: journal-only

      const distinctId = await this.identity.resolveDistinctId(integration.projectId, ev.app_user_id);
      const state = await this.upsertState(integration.projectId, ev, distinctId, nowMs);
      if (distinctId === null) return { status: 'unlinked' };

      await this.clickhouse.insertEvents([toEventRow(integration.projectId, distinctId, ev, nowMs)]);
      await this.profileWriter.apply(integration.projectId, profileOpsFor(distinctId, state, nowMs), nowMs);
      return { status: 'processed' };
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async upsertState(
    projectId: string,
    ev: RcWebhookEvent,
    distinctId: string | null,
    nowMs: number,
  ) {
    const patch = deriveStatePatch(ev);
    const { addSpendCents, firstPurchaseAt, ...fields } = patch;
    const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    return this.prisma.subscriptionState.upsert({
      where: { projectId_rcAppUserId: { projectId, rcAppUserId: ev.app_user_id } },
      create: {
        projectId,
        rcAppUserId: ev.app_user_id,
        distinctId,
        status: patch.status ?? 'active',
        productId: patch.productId ?? null,
        store: patch.store ?? null,
        periodType: patch.periodType ?? null,
        priceCents: patch.priceCents ?? null,
        currency: patch.currency ?? null,
        mrrCents: patch.mrrCents ?? 0,
        totalSpentCents: addSpendCents,
        firstPurchaseAt: firstPurchaseAt ?? null,
        expiresAt: patch.expiresAt ?? null,
        cancelledAt: patch.cancelledAt ?? null,
        lastEventAt: new Date(nowMs),
      },
      update: {
        ...defined,
        ...(distinctId !== null ? { distinctId } : {}),
        totalSpentCents: { increment: addSpendCents },
        // firstPurchaseAt is set-once: only on create, never touched here
        lastEventAt: new Date(nowMs),
      },
    });
  }
}
