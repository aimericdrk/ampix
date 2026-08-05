import { randomUUID } from 'node:crypto';
import { JournalStatus, PrismaClient, Store } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { StoreNotificationJournalService } from './store-notification-journal.service';

jest.setTimeout(180000);

describe('StoreNotificationJournalService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: StoreNotificationJournalService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new StoreNotificationJournalService(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
  });

  describe('record', () => {
    it('inserts a provisional FAILED row by default (journal-first fail-safe)', async () => {
      const row = await service.record({
        store: Store.APP_STORE,
        storeEventId: randomUUID(),
        notificationType: 'SUBSCRIBED',
        payload: { hello: 'world' },
      });
      expect(row).toMatchObject({ status: 'FAILED', error: 'processing did not complete', processedAt: null });
    });

    it('accepts an explicit terminal status with no default error (e.g. unresolved App -> SKIPPED)', async () => {
      const row = await service.record({
        store: Store.PLAY_STORE,
        storeEventId: randomUUID(),
        notificationType: 'SUBSCRIPTION_PURCHASED',
        payload: {},
        status: JournalStatus.SKIPPED,
      });
      expect(row).toMatchObject({ status: 'SKIPPED', error: null, projectId: null });
    });

    it('is idempotent on a duplicate (store, storeEventId): second call is a no-op, no second row', async () => {
      const storeEventId = randomUUID();
      const first = await service.record({
        store: Store.APP_STORE,
        storeEventId,
        notificationType: 'DID_RENEW',
        payload: { n: 1 },
      });
      const second = await service.record({
        store: Store.APP_STORE,
        storeEventId,
        notificationType: 'DID_RENEW',
        payload: { n: 2 },
      });

      expect(first).not.toBeNull();
      expect(second).toBeNull();

      const rows = await prisma.storeNotification.findMany({ where: { store: Store.APP_STORE, storeEventId } });
      expect(rows).toHaveLength(1);
    });

    it('scopes idempotency per store: the same event id under a different store is a distinct row', async () => {
      const storeEventId = randomUUID();
      const apple = await service.record({
        store: Store.APP_STORE,
        storeEventId,
        notificationType: 'DID_RENEW',
        payload: {},
      });
      const google = await service.record({
        store: Store.PLAY_STORE,
        storeEventId,
        notificationType: 'SUBSCRIPTION_RENEWED',
        payload: {},
      });
      expect(apple).not.toBeNull();
      expect(google).not.toBeNull();
      expect(apple!.id).not.toBe(google!.id);
    });
  });

  describe('finalize helpers', () => {
    it('markProcessed sets status + processedAt and clears error', async () => {
      const row = (await service.record({
        store: Store.APP_STORE,
        storeEventId: randomUUID(),
        notificationType: 'DID_RENEW',
        payload: {},
      }))!;

      const updated = await service.markProcessed(row.id, 1_700_000_000_000);
      expect(updated).toMatchObject({ status: 'PROCESSED', error: null });
      expect(updated.processedAt).not.toBeNull();
    });

    it('markFailed records the error message', async () => {
      const row = (await service.record({
        store: Store.APP_STORE,
        storeEventId: randomUUID(),
        notificationType: 'DID_RENEW',
        payload: {},
      }))!;

      const updated = await service.markFailed(row.id, 'boom');
      expect(updated).toMatchObject({ status: 'FAILED', error: 'boom' });
    });

    it('markUnlinked clears error and leaves the row replayable', async () => {
      const row = (await service.record({
        store: Store.APP_STORE,
        storeEventId: randomUUID(),
        notificationType: 'DID_RENEW',
        payload: {},
      }))!;

      const updated = await service.markUnlinked(row.id);
      expect(updated).toMatchObject({ status: 'UNLINKED', error: null });
    });

    it('markSkipped records an optional reason', async () => {
      const row = (await service.record({
        store: Store.APP_STORE,
        storeEventId: randomUUID(),
        notificationType: 'TEST',
        payload: {},
      }))!;

      const updated = await service.markSkipped(row.id, 'unknown bundleId');
      expect(updated).toMatchObject({ status: 'SKIPPED', error: 'unknown bundleId' });
    });
  });

  describe('listUnlinkedForReplay', () => {
    it('returns only UNLINKED + FAILED rows, oldest-first, scoped by projectId and appUserId', async () => {
      const appUserId = 'replay-user';
      const other = await service.record({
        store: Store.APP_STORE,
        storeEventId: randomUUID(),
        notificationType: 'DID_RENEW',
        payload: {},
        projectId: randomUUID(), // different project — must not leak into this project's replay list
        appUserId,
        status: JournalStatus.UNLINKED,
      });
      expect(other).not.toBeNull();

      const unlinked = (await service.record({
        store: Store.APP_STORE,
        storeEventId: randomUUID(),
        notificationType: 'DID_RENEW',
        payload: {},
        projectId,
        appUserId,
        status: JournalStatus.UNLINKED,
      }))!;
      const failed = (await service.record({
        store: Store.PLAY_STORE,
        storeEventId: randomUUID(),
        notificationType: 'SUBSCRIPTION_RENEWED',
        payload: {},
        projectId,
        appUserId,
      }))!; // defaults to FAILED
      const processed = (await service.record({
        store: Store.APP_STORE,
        storeEventId: randomUUID(),
        notificationType: 'SUBSCRIBED',
        payload: {},
        projectId,
        appUserId,
      }))!;
      await service.markProcessed(processed.id);

      const skipped = (await service.record({
        store: Store.PLAY_STORE,
        storeEventId: randomUUID(),
        notificationType: 'TEST',
        payload: {},
        projectId,
        appUserId,
        status: JournalStatus.SKIPPED,
      }))!;

      const replayable = await service.listUnlinkedForReplay({ projectId, appUserId });
      const replayableIds = replayable.map((r) => r.id);

      expect(replayableIds).toEqual([unlinked.id, failed.id]);
      expect(replayableIds).not.toContain(processed.id);
      expect(replayableIds).not.toContain(skipped.id);
      expect(replayableIds).not.toContain(other!.id);
    });

    it('caps the batch with `take`', async () => {
      const appUserId = 'cap-user';
      for (let i = 0; i < 3; i += 1) {
        await service.record({
          store: Store.APP_STORE,
          storeEventId: randomUUID(),
          notificationType: 'DID_RENEW',
          payload: {},
          projectId,
          appUserId,
        });
      }

      const page = await service.listUnlinkedForReplay({ projectId, appUserId, take: 2 });
      expect(page).toHaveLength(2);
    });
  });
});
