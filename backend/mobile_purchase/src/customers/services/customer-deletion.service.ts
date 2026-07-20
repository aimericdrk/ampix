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
}
