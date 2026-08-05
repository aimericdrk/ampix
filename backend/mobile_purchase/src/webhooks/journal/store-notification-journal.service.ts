import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalStatus, Prisma, Store } from '../../../generated/client';

export interface RecordNotificationInput {
  store: Store;
  storeEventId: string; // Apple notificationUUID / Google messageId — idempotency key with `store`
  notificationType: string;
  subtype?: string;
  projectId?: string; // unresolved (unknown bundleId/packageName) rows leave this null
  appId?: string;
  appUserId?: string; // resolved link, if already known at insert time
  payload: Prisma.InputJsonValue; // full verified + decoded notification
  /** Provisional status. Defaults to FAILED — the journal-first fail-safe provisional row
   * (design §7): a crash between insert and finalize leaves a replayable row, never a false
   * PROCESSED. Pass a terminal status (e.g. SKIPPED for an unresolved App) when it is already
   * known at insert time. */
  status?: JournalStatus;
  error?: string;
}

/**
 * Webhook journal — journal-first idempotency + unlinked-replay backbone (design §7), mirroring
 * `rc-webhook.processor.ts`'s pattern without the RevenueCat coupling. M1 only provides the
 * journal primitives (record/finalize/list); the verify -> decode -> handle flow that calls them
 * is M2 (Apple) / M3 (Google).
 */
@Injectable()
export class StoreNotificationJournalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts a journal row. A duplicate delivery — the same (store, storeEventId) already
   * journaled — hits Prisma P2002 and is an idempotent no-op: returns `null`, no error, no
   * second row. Verification failures must never reach this method (design §7: they are not
   * real store calls and journal nothing).
   */
  async record(input: RecordNotificationInput) {
    const status = input.status ?? JournalStatus.FAILED;
    try {
      return await this.prisma.storeNotification.create({
        data: {
          projectId: input.projectId ?? null,
          appId: input.appId ?? null,
          store: input.store,
          storeEventId: input.storeEventId,
          notificationType: input.notificationType,
          subtype: input.subtype ?? null,
          appUserId: input.appUserId ?? null,
          payload: input.payload,
          status,
          error: input.error ?? (status === JournalStatus.FAILED ? 'processing did not complete' : null),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) return null; // idempotent no-op — duplicate store delivery
      throw e;
    }
  }

  markProcessed(id: string, nowMs = Date.now()) {
    return this.finalize(id, JournalStatus.PROCESSED, null, nowMs);
  }

  markFailed(id: string, error: string, nowMs = Date.now()) {
    return this.finalize(id, JournalStatus.FAILED, error, nowMs);
  }

  /** No customer link could be resolved yet — the row sits UNLINKED until a later replay. */
  markUnlinked(id: string, nowMs = Date.now()) {
    return this.finalize(id, JournalStatus.UNLINKED, null, nowMs);
  }

  markSkipped(id: string, reason?: string, nowMs = Date.now()) {
    return this.finalize(id, JournalStatus.SKIPPED, reason ?? null, nowMs);
  }

  private finalize(id: string, status: JournalStatus, error: string | null, nowMs: number) {
    return this.prisma.storeNotification.update({
      where: { id },
      data: { status, error, processedAt: new Date(nowMs) },
    });
  }

  /**
   * Lists UNLINKED (no customer link yet) + FAILED (errored) rows oldest-first, capped, for
   * replay — identical selection to the RC mirror's `replayUnlinked`. The actual re-run of each
   * row's handler belongs to the caller (M2/M3); this is the read side of the sweep.
   */
  listUnlinkedForReplay(params: { projectId?: string; appUserId?: string; take?: number } = {}) {
    return this.prisma.storeNotification.findMany({
      where: {
        status: { in: [JournalStatus.UNLINKED, JournalStatus.FAILED] },
        ...(params.projectId !== undefined ? { projectId: params.projectId } : {}),
        ...(params.appUserId !== undefined ? { appUserId: params.appUserId } : {}),
      },
      // `receivedAt` is millisecond-precision, so same-ms rows would replay in nondeterministic
      // order; `id` is uuid(7) (time-ordered) and breaks the tie strictly oldest-first.
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: params.take ?? 200,
    });
  }
}

/** Prisma P2002 = unique constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
