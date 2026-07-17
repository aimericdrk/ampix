import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Store } from '../../../generated/client';
import { assertValidAppUserId } from '../support/app-user-id.validator';

/**
 * Minimal Customer persistence for M1: resolve-or-create by app_user_id (reserved-id validated at
 * the boundary, §3) and look a Customer up by the store-side account token a webhook carries
 * (Apple appAccountToken / Google obfuscatedExternalAccountId) — the self-attribution link M2-M5
 * need. No aliasing/identity-graph (P5, out of scope) and no attribute writes here.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the Customer for (projectId, appUserId), creating it on first sight. Rejects a
   * reserved/invalid app_user_id fail-closed, before any persistence is attempted.
   * `reservedStoreIds` lets a caller that already knows the owning App (bundleId/packageName/
   * publicSdkKey) block those collisions too — optional, since not every caller has an App yet.
   */
  async getOrCreateCustomer(projectId: string, appUserId: string, reservedStoreIds: string[] = []) {
    assertValidAppUserId(appUserId, reservedStoreIds);
    const trimmedAppUserId = appUserId.trim();
    const now = new Date();
    return this.prisma.customer.upsert({
      where: { projectId_appUserId: { projectId, appUserId: trimmedAppUserId } },
      create: { projectId, appUserId: trimmedAppUserId, lastSeenAt: now },
      update: { lastSeenAt: now },
    });
  }

  /**
   * Looks up a Customer by the store-side account token a store notification self-attributes
   * with (Apple `appAccountToken` for APP_STORE, Google `obfuscatedExternalAccountId` for
   * PLAY_STORE). Returns null when no Customer has bound that token yet — the caller (M2/M3) is
   * expected to journal the notification as UNLINKED in that case.
   */
  findByStoreToken(projectId: string, store: Store, token: string) {
    return this.prisma.customer.findFirst({
      where:
        store === Store.APP_STORE
          ? { projectId, appleAppAccountToken: token }
          : { projectId, googleObfuscatedId: token },
    });
  }
}
