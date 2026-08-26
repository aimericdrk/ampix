import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';

/**
 * Deletes a Customer (design §1.4). `prisma.customer.delete` cascades onto `Subscription` and
 * `PromotionalEntitlement` (both `onDelete: Cascade`); `Transaction` rows are preserved with
 * `customerId` set to NULL (`onDelete: SetNull`) — the revenue ledger survives, anonymized of
 * the customer's PII (appUserId, store tokens, attributes).
 */
@Injectable()
export class CustomerDeletionService {
  constructor(private readonly prisma: PrismaService) {}

  async remove(projectId: string, customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, projectId }, select: { id: true } });
    if (!customer) throw new ProblemException({ status: 404, title: 'Customer not found' });
    await this.prisma.customer.delete({ where: { id: customerId } });
  }

  /**
   * Server-to-server erasure by the SDK-facing identity (account deletion / GDPR). Idempotent —
   * an unknown appUserId is not an error, so the calling backend can safely retry. Beyond the
   * Customer cascade above, this also scrubs the user's `store_notifications` journal rows
   * (StoreNotification.appUserId has no FK, so the cascade never touches it): the rows themselves
   * are KEPT so `(store, storeEventId)` idempotency still rejects store retries/replays — only the
   * user link and the payload (which embeds store account tokens) are cleared.
   */
  async removeByAppUserId(
    projectId: string,
    appUserId: string,
  ): Promise<{ customerDeleted: boolean; storeNotificationsScrubbed: number }> {
    const customer = await this.prisma.customer.findUnique({
      where: { projectId_appUserId: { projectId, appUserId } },
      select: { id: true },
    });
    if (customer) {
      await this.prisma.customer.delete({ where: { id: customer.id } });
    }
    const scrubbed = await this.prisma.storeNotification.updateMany({
      where: { projectId, appUserId },
      data: { appUserId: null, payload: {}, error: null },
    });
    return { customerDeleted: customer !== null, storeNotificationsScrubbed: scrubbed.count };
  }
}
