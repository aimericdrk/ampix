import { randomUUID } from 'node:crypto';
import { PrismaClient, Store } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { CustomersService } from './customers.service';

jest.setTimeout(180000);

describe('CustomersService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: CustomersService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new CustomersService(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
  });

  describe('getOrCreateCustomer', () => {
    it('creates a customer on first sight and returns the same row on a repeat call', async () => {
      const first = await service.getOrCreateCustomer(projectId, 'user-1');
      expect(first.projectId).toBe(projectId);
      expect(first.appUserId).toBe('user-1');
      expect(first.lastSeenAt).not.toBeNull();

      const second = await service.getOrCreateCustomer(projectId, 'user-1');
      expect(second.id).toBe(first.id);

      const rows = await prisma.customer.findMany({ where: { projectId, appUserId: 'user-1' } });
      expect(rows).toHaveLength(1);
    });

    it('scopes app_user_id uniqueness per project — the same id in another project is a different customer', async () => {
      const otherProjectId = randomUUID();
      const mine = await service.getOrCreateCustomer(projectId, 'shared-id');
      const theirs = await service.getOrCreateCustomer(otherProjectId, 'shared-id');
      expect(mine.id).not.toBe(theirs.id);
    });

    it('rejects a reserved app_user_id and persists nothing', async () => {
      await expect(service.getOrCreateCustomer(projectId, 'null')).rejects.toMatchObject({
        problem: { status: 400 },
      });
      const rows = await prisma.customer.findMany({ where: { projectId } });
      expect(rows).toHaveLength(0);
    });

    it('rejects an app_user_id colliding with a caller-supplied reserved store id', async () => {
      await expect(
        service.getOrCreateCustomer(projectId, 'com.myampix.app', ['com.myampix.app']),
      ).rejects.toMatchObject({ problem: { status: 400 } });
    });
  });

  describe('findByStoreToken', () => {
    it('resolves a customer by Apple appAccountToken', async () => {
      const token = randomUUID();
      const customer = await prisma.customer.create({
        data: { projectId, appUserId: 'apple-user', appleAppAccountToken: token },
      });

      await expect(service.findByStoreToken(projectId, Store.APP_STORE, token)).resolves.toMatchObject({
        id: customer.id,
      });
    });

    it('resolves a customer by Google obfuscatedExternalAccountId', async () => {
      const obfuscatedId = 'g-' + randomUUID();
      const customer = await prisma.customer.create({
        data: { projectId, appUserId: 'google-user', googleObfuscatedId: obfuscatedId },
      });

      await expect(
        service.findByStoreToken(projectId, Store.PLAY_STORE, obfuscatedId),
      ).resolves.toMatchObject({ id: customer.id });
    });

    it('returns null when no customer has bound the token', async () => {
      await expect(service.findByStoreToken(projectId, Store.APP_STORE, randomUUID())).resolves.toBeNull();
    });

    it('does not resolve a token bound in another project', async () => {
      const token = randomUUID();
      await prisma.customer.create({
        data: { projectId: randomUUID(), appUserId: 'cross-tenant', appleAppAccountToken: token },
      });

      await expect(service.findByStoreToken(projectId, Store.APP_STORE, token)).resolves.toBeNull();
    });
  });
});
