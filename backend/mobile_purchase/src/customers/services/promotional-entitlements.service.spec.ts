import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { PromotionalEntitlementsService } from './promotional-entitlements.service';

jest.setTimeout(180000);

describe('PromotionalEntitlementsService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: PromotionalEntitlementsService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new PromotionalEntitlementsService(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
  });

  async function seedCustomerAndEntitlement() {
    const customer = await prisma.customer.create({ data: { projectId, appUserId: `u-${randomUUID()}` } });
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'pro', displayName: 'Pro' },
    });
    return { customer, entitlement };
  }

  describe('grant', () => {
    it('creates a lifetime grant with expiresAt null', async () => {
      const { customer, entitlement } = await seedCustomerAndEntitlement();

      const grant = await service.grant(projectId, customer.id, {
        entitlementId: entitlement.id,
        duration: 'lifetime',
      });

      expect(grant).toMatchObject({
        entitlementIdentifier: 'pro',
        expiresAt: null,
        revokedAt: null,
        note: null,
      });
      const persisted = await prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } });
      expect(persisted).toMatchObject({ projectId, customerId: customer.id, entitlementId: entitlement.id });
    });

    it('creates a monthly grant with expiresAt after grantedAt, and persists the note', async () => {
      const { customer, entitlement } = await seedCustomerAndEntitlement();

      const grant = await service.grant(projectId, customer.id, {
        entitlementId: entitlement.id,
        duration: 'monthly',
        note: 'goodwill credit',
      });

      expect(grant.expiresAt).not.toBeNull();
      expect((grant.expiresAt as Date).getTime()).toBeGreaterThan(grant.grantedAt.getTime());
      expect(grant.note).toBe('goodwill credit');

      const persisted = await prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } });
      expect(persisted?.note).toBe('goodwill credit');
    });

    it('404s when the customer does not belong to the project', async () => {
      const { entitlement } = await seedCustomerAndEntitlement();
      const otherProjectCustomer = await prisma.customer.create({
        data: { projectId: randomUUID(), appUserId: `u-${randomUUID()}` },
      });

      await expect(
        service.grant(projectId, otherProjectCustomer.id, { entitlementId: entitlement.id, duration: 'daily' }),
      ).rejects.toMatchObject({ problem: { status: 404, title: 'Customer not found' } });
    });

    it('404s when the entitlement does not belong to the project', async () => {
      const { customer } = await seedCustomerAndEntitlement();
      const otherProjectEntitlement = await prisma.entitlement.create({
        data: { projectId: randomUUID(), identifier: 'foreign', displayName: 'Foreign' },
      });

      await expect(
        service.grant(projectId, customer.id, { entitlementId: otherProjectEntitlement.id, duration: 'daily' }),
      ).rejects.toMatchObject({ problem: { status: 404, title: 'Entitlement not found' } });
    });
  });
});
