import { Inject, Injectable } from '@nestjs/common';
import { Store, SubscriptionStatus } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import { GOOGLE_STORE_CLIENT } from '../../webhooks/google/google-store-client.factory';
import { GoogleCredentialsUnavailableError } from '../../webhooks/google/store-client.google-api';
import type { StoreClient } from '../../webhooks/google/store-client';

export interface RefundResult {
  id: string;
  status: 'REVOKED';
  refundedAt: Date;
}

/** Design §1.2 precondition — RC shows Refund only for currently-entitled subscriptions: the
 * entitled statuses per the `SubscriptionStatus` enum comments (`CANCELLED` = auto-renew off but
 * still entitled until `expiresAt`). Everything else 409s before any store call. */
const REFUNDABLE_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIAL,
  SubscriptionStatus.INTRO,
  SubscriptionStatus.GRACE_PERIOD,
  SubscriptionStatus.CANCELLED,
]);

/**
 * The D1 Refund action (design §1.2): a Google Play, active-subscription refund. Store-gated only
 * — ALWAYS calls `StoreClient.revokeAndRefundSubscription` (creds-gated: without live credentials
 * it throws `GoogleCredentialsUnavailableError` → 503, identical posture to the receipts path in
 * `google-receipt-validator.ts`); the local `refundedAt`/`revokedAt` writes happen ONLY after a
 * successful store call, in one `prisma.$transaction`. No "local-only refund" mode.
 */
@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GOOGLE_STORE_CLIENT) private readonly storeClient: StoreClient,
  ) {}

  async refund(
    projectId: string,
    customerId: string,
    subscriptionId: string,
    nowMs: number = Date.now(),
  ): Promise<RefundResult> {
    // Design §1.2 step 1 — double-scoped load (`Subscription` carries both `customerId` and
    // `projectId`, so one filter asserts both scopes); not-found / cross-customer / cross-project
    // all 404 with the SAME opaque title — never leak which scope failed.
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, customerId, projectId },
      select: { id: true, store: true, status: true, refundedAt: true, purchaseToken: true, appId: true },
    });
    if (!subscription) throw new ProblemException({ status: 404, title: 'Subscription not found' });

    // Design §1.2 step 2 — preconditions, all checked BEFORE the store call.
    if (subscription.store !== Store.PLAY_STORE) {
      throw new ProblemException({ status: 409, title: 'Refunds are only available for Google Play subscriptions.' });
    }
    if (subscription.refundedAt !== null) {
      throw new ProblemException({ status: 409, title: 'This subscription has already been refunded.' });
    }
    if (!REFUNDABLE_STATUSES.has(subscription.status)) {
      throw new ProblemException({ status: 409, title: 'Only active subscriptions can be refunded.' });
    }
    if (!subscription.purchaseToken) {
      // Defensive — a PLAY_STORE sub always has one (design §1.2 step 2).
      throw new ProblemException({ status: 409, title: 'Subscription is missing its Google purchase token.' });
    }

    // Design §1.2 step 3 — resolve the store identity via the sub's App.
    const app = await this.prisma.app.findUnique({
      where: { id: subscription.appId },
      select: { packageName: true },
    });
    if (!app?.packageName) {
      throw new ProblemException({ status: 409, title: 'App is not configured for Google Play.' });
    }

    // Design §1.2 step 4 — the creds-gated store call. 503 mapping is verbatim the receipts path
    // (`google-receipt-validator.ts` `toCredentialsUnavailable`); any other store error is a 502.
    try {
      await this.storeClient.revokeAndRefundSubscription(app.packageName, subscription.purchaseToken);
    } catch (e) {
      if (e instanceof GoogleCredentialsUnavailableError) {
        throw new ProblemException({ status: 503, title: 'Store credentials unavailable', detail: e.message });
      }
      throw new ProblemException({
        status: 502,
        title: 'Store rejected the refund',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Design §1.2 step 5 — reflect locally ONLY after store success, atomically. RC refunds "the
    // last purchase": only the latest transaction gets `revokedAt` (if not already set); zero
    // transactions → skip that write, the subscription-level refund still stands.
    const refundedAt = new Date(nowMs);
    await this.prisma.$transaction(async (tx) => {
      // Guard against a concurrent refund landing between the precondition check above and this
      // write: only the transaction that still finds `refundedAt: null` wins; the loser 409s here
      // instead of clobbering the winner's `refundedAt`.
      const { count } = await tx.subscription.updateMany({
        where: { id: subscription.id, refundedAt: null },
        data: { status: SubscriptionStatus.REVOKED, refundedAt },
      });
      if (count === 0) {
        throw new ProblemException({ status: 409, title: 'This subscription has already been refunded.' });
      }
      const latestTransaction = await tx.transaction.findFirst({
        where: { subscriptionId: subscription.id, projectId },
        orderBy: { purchasedAt: 'desc' },
        select: { id: true, revokedAt: true },
      });
      if (latestTransaction && latestTransaction.revokedAt === null) {
        await tx.transaction.update({ where: { id: latestTransaction.id }, data: { revokedAt: refundedAt } });
      }
    });

    return { id: subscription.id, status: 'REVOKED', refundedAt };
  }
}
