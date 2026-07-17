import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Customer } from '../../../generated/client';
import { Store } from '../../../generated/client';
import { assertValidAppUserId } from '../support/app-user-id.validator';
import { ProblemException } from '../../common/problem-details';

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

  /**
   * M5b (`POST /v1/receipts`): writes the store-side self-attribution token (Apple
   * `appAccountToken` for APP_STORE, Google `obfuscatedExternalAccountId` for PLAY_STORE) onto an
   * already-resolved Customer — the explicit bind design §10 Option (i) relies on: a webhook that
   * lands `UNLINKED` before this bind resolves on the next `/v1/receipts` intake + replay.
   *
   * **Uniqueness — REJECT, not reassign (M5b's documented choice):** a given token may map to at
   * most one Customer per project, enforced by the DB-level `@@unique([projectId,
   * appleAppAccountToken])` / `@@unique([projectId, googleObfuscatedId])` constraints (nullable
   * columns — Postgres never treats two NULLs as colliding, so unbound customers never conflict).
   * If a second, DIFFERENT app_user_id's Customer tries to bind a token another Customer already
   * owns, the write hits Prisma's `P2002` and this throws a `409` `ProblemException` — the receipt
   * is rejected rather than silently transferring the purchase to a new identity. Rationale: unlike
   * RC's dashboard-configurable "transfer purchase" behavior, this service has no product surface
   * yet to make that an informed, auditable decision — failing closed (409) surfaces the conflict
   * to the caller instead of silently reassigning revenue attribution.
   *
   * Binding the SAME token to the SAME Customer again (e.g. a repeat receipt for the same
   * purchase) is a harmless no-op update — Postgres does not treat updating a row to its own
   * current value as a uniqueness violation.
   */
  async bindStoreToken(projectId: string, customerId: string, store: Store, token: string): Promise<Customer> {
    const data = store === Store.APP_STORE ? { appleAppAccountToken: token } : { googleObfuscatedId: token };
    try {
      return await this.prisma.customer.update({ where: { id: customerId }, data });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const field = store === Store.APP_STORE ? 'Apple appAccountToken' : 'Google obfuscatedExternalAccountId';
        throw new ProblemException({
          status: 409,
          title: 'Store token already bound',
          detail: `This ${field} is already bound to a different customer in this project`,
        });
      }
      throw e;
    }
  }
}

/** Prisma P2002 = unique constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
