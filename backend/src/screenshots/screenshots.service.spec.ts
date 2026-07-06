import { Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { AppConfig } from '../config/app-config';
import type { PrismaService } from '../prisma/prisma.service';
import type { ProjectsService } from '../projects/projects.service';
import {
  ScreenshotsService,
  StoreScreenshotInput,
  screenshotObjectPath,
} from './screenshots.service';
import type { ScreenshotStorage } from './storage/screenshot-storage.port';

const USER = 'user-1';
const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';
const ORG = '018f6b2e-0000-7000-8000-0000000000b2';

interface PrismaMock {
  screenCapture: {
    upsert: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    deleteMany: jest.Mock;
  };
  project: {
    findUnique: jest.Mock;
  };
}

interface StorageMock {
  probe: jest.Mock;
  put: jest.Mock;
  getStream: jest.Mock;
  signedUrl: jest.Mock;
  delete: jest.Mock;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

function makeService(screenshotMaxKb = 512, configOverrides: Partial<AppConfig> = {}) {
  const prismaMock: PrismaMock = {
    screenCapture: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({ orgId: ORG }),
    },
  };
  const storageMock: StorageMock = {
    probe: jest.fn().mockResolvedValue({ ok: true }),
    put: jest.fn().mockResolvedValue(undefined),
    getStream: jest.fn().mockResolvedValue(null),
    signedUrl: jest.fn().mockResolvedValue('memory://x'),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const assertMembership = jest.fn().mockResolvedValue(undefined);
  const prisma = prismaMock as unknown as PrismaService;
  const projects = { assertMembership } as unknown as ProjectsService;
  const config = { screenshotMaxKb, ...configOverrides } as AppConfig;
  const storage = storageMock as unknown as ScreenshotStorage;
  return {
    service: new ScreenshotsService(prisma, projects, config, storage),
    prisma: prismaMock,
    storage: storageMock,
    assertMembership,
  };
}

function makeInput(overrides: Partial<StoreScreenshotInput> = {}): StoreScreenshotInput {
  return {
    projectId: PROJECT,
    screenName: 'checkout',
    appVersion: '1.0.0',
    width: 640,
    height: 1280,
    imageHash: 'abc123',
    contentType: 'image/jpeg',
    image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    ...overrides,
  };
}

describe('screenshotObjectPath', () => {
  it('builds a deterministic {org}/{project}/screen/{name}/{version} path', () => {
    expect(screenshotObjectPath(ORG, PROJECT, 'checkout', '1.0.0')).toBe(
      `${ORG}/${PROJECT}/screen/checkout/1.0.0.jpg`,
    );
  });

  it('encodes unsafe characters in the name/version so a segment cannot escape its folder', () => {
    expect(screenshotObjectPath(ORG, PROJECT, 'a/b', '1.0')).toBe(
      `${ORG}/${PROJECT}/screen/a%2Fb/1.0.jpg`,
    );
  });
});

describe('ScreenshotsService', () => {
  describe('store', () => {
    it('puts the bytes to storage then UPSERTs metadata on the unique triple', async () => {
      const { service, prisma, storage } = makeService();
      const input = makeInput();
      const result = await service.store(input);

      expect(result).toEqual({ stored: true });

      const expectedPath = screenshotObjectPath(ORG, PROJECT, 'checkout', '1.0.0');
      expect(storage.put).toHaveBeenCalledWith(expectedPath, input.image, 'image/jpeg');

      expect(prisma.screenCapture.upsert).toHaveBeenCalledTimes(1);
      const arg = prisma.screenCapture.upsert.mock.calls[0][0];
      expect(arg.where).toEqual({
        projectId_screenName_appVersion: {
          projectId: PROJECT,
          screenName: 'checkout',
          appVersion: '1.0.0',
        },
      });
      // Both branches persist the object path (no bytea) — a re-send overwrites, not appends.
      expect(arg.create).toMatchObject({ storagePath: expectedPath, contentType: 'image/jpeg' });
      expect(arg.update).toMatchObject({ storagePath: expectedPath });
      expect(arg.update).not.toHaveProperty('projectId');
    });

    it('caps at one object/row per version — a replace reuses the SAME path + key', async () => {
      const { service, prisma, storage } = makeService();
      await service.store(makeInput({ imageHash: 'h1' }));
      await service.store(makeInput({ imageHash: 'h2' }));

      const paths = storage.put.mock.calls.map((c) => c[0]);
      expect(paths[0]).toBe(paths[1]); // same deterministic path => overwrite
      const keys = prisma.screenCapture.upsert.mock.calls.map((c) => c[0].where);
      expect(keys[0]).toEqual(keys[1]);
    });

    it('rejects a non-jpeg content type with 415 and never touches storage or the DB', async () => {
      const { service, prisma, storage } = makeService();
      await expect(service.store(makeInput({ contentType: 'image/png' }))).rejects.toMatchObject({
        problem: { status: 415 },
      });
      expect(storage.put).not.toHaveBeenCalled();
      expect(prisma.screenCapture.upsert).not.toHaveBeenCalled();
    });

    it('rejects an oversize image with 413 (bytes > SCREENSHOT_MAX_KB)', async () => {
      const { service, storage } = makeService(1); // 1 KB cap
      await expect(service.store(makeInput({ image: Buffer.alloc(2 * 1024, 0xff) }))).rejects.toMatchObject({
        problem: { status: 413 },
      });
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('accepts an image exactly at the cap boundary', async () => {
      const { service, storage } = makeService(1);
      await expect(service.store(makeInput({ image: Buffer.alloc(1024, 0xff) }))).resolves.toEqual({
        stored: true,
      });
      expect(storage.put).toHaveBeenCalledTimes(1);
    });

    it('rejects a missing/empty image with 400', async () => {
      const { service } = makeService();
      await expect(service.store(makeInput({ image: Buffer.alloc(0) }))).rejects.toMatchObject({
        problem: { status: 400 },
      });
    });

    it('rejects missing screen_name or app_version with 400', async () => {
      const { service } = makeService();
      await expect(service.store(makeInput({ screenName: '' }))).rejects.toMatchObject({
        problem: { status: 400 },
      });
      await expect(service.store(makeInput({ appVersion: '' }))).rejects.toMatchObject({
        problem: { status: 400 },
      });
    });

    it('logs at ERROR and throws 502 (with the underlying reason) when storage.put rejects', async () => {
      const { service, prisma, storage } = makeService(512, {
        firebaseStorageBucket: 'my-bucket.appspot.com',
      });
      storage.put.mockRejectedValue(new Error('permission denied on bucket'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.store(makeInput())).rejects.toMatchObject({
        problem: {
          status: 502,
          title: 'Bad Gateway',
          detail: expect.stringContaining('permission denied on bucket'),
        },
      });

      // Never persist a metadata row pointing at bytes that were never written.
      expect(prisma.screenCapture.upsert).not.toHaveBeenCalled();
      // The real error + context (path, bucket) reached the logs at ERROR level.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message] = errorSpy.mock.calls[0];
      expect(message).toContain('permission denied on bucket');
      expect(message).toContain(screenshotObjectPath(ORG, PROJECT, 'checkout', '1.0.0'));
      expect(message).toContain('my-bucket.appspot.com');
      errorSpy.mockRestore();
    });

    it('logs the stored path at LOG level on success', async () => {
      const { service } = makeService();
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      await service.store(makeInput());

      const logged = logSpy.mock.calls.map((c) => String(c[0]));
      expect(
        logged.some(
          (line) =>
            line.includes('screenshot stored') &&
            line.includes('screen=checkout') &&
            line.includes('app_version=1.0.0') &&
            line.includes(screenshotObjectPath(ORG, PROJECT, 'checkout', '1.0.0')),
        ),
      ).toBe(true);
      logSpy.mockRestore();
    });
  });

  describe('onModuleInit (boot-time storage probe)', () => {
    it('probes and logs reachability when a Firebase bucket is configured', async () => {
      const { service, storage } = makeService(512, {
        firebaseStorageBucket: 'my-bucket.appspot.com',
      });
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      await service.onModuleInit();

      expect(storage.probe).toHaveBeenCalledTimes(1);
      const logged = logSpy.mock.calls.map((c) => String(c[0]));
      expect(
        logged.some((line) => line.includes('reachable') && line.includes('gs://my-bucket.appspot.com')),
      ).toBe(true);
      logSpy.mockRestore();
    });

    it('logs at ERROR (without crashing) when the probe reports the bucket is NOT reachable', async () => {
      const { service, storage } = makeService(512, {
        firebaseStorageBucket: 'wrong-bucket',
      });
      storage.probe.mockResolvedValue({ ok: false, detail: 'bucket does not exist' });
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message] = errorSpy.mock.calls[0];
      expect(message).toContain('NOT reachable');
      expect(message).toContain('bucket does not exist');
      errorSpy.mockRestore();
    });

    it('does not crash boot even if the probe itself throws', async () => {
      const { service, storage } = makeService(512, {
        firebaseStorageBucket: 'boom-bucket',
      });
      storage.probe.mockRejectedValue(new Error('network unreachable'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain('network unreachable');
      errorSpy.mockRestore();
    });

    it('skips the probe entirely when no bucket is configured (in-memory fallback)', async () => {
      const { service, storage } = makeService(); // no firebaseStorageBucket
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(storage.probe).not.toHaveBeenCalled();
    });
  });

  describe('listScreens', () => {
    it('gates on membership and folds versions into capture_count with latest metadata', async () => {
      const { service, prisma, assertMembership } = makeService();
      const newer = new Date('2026-07-02T10:00:00.000Z');
      const older = new Date('2026-07-01T10:00:00.000Z');
      prisma.screenCapture.findMany.mockResolvedValue([
        { screenName: 'checkout', width: 640, height: 1280, capturedAt: newer, imageHash: 'hash-checkout-2', appVersion: '2.0.0' },
        { screenName: 'checkout', width: 320, height: 640, capturedAt: older, imageHash: 'hash-checkout-1', appVersion: '1.0.0' },
        { screenName: 'home', width: 400, height: 800, capturedAt: older, imageHash: 'hash-home', appVersion: '1.0.0' },
      ]);

      const result = await service.listScreens(USER, PROJECT);

      expect(assertMembership).toHaveBeenCalledWith(USER, PROJECT);
      expect(prisma.screenCapture.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: PROJECT } }),
      );
      // Neither bytes nor a storage path are selected (cheap metadata read).
      const select = prisma.screenCapture.findMany.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('storagePath');
      // The newest capture per screen supplies latest_image_hash / latest_app_version (rows desc).
      expect(result.screens).toEqual([
        {
          screen_name: 'checkout',
          capture_count: 2,
          latest_captured_at: newer.toISOString(),
          width: 640,
          height: 1280,
          latest_image_hash: 'hash-checkout-2',
          latest_app_version: '2.0.0',
        },
        {
          screen_name: 'home',
          capture_count: 1,
          latest_captured_at: older.toISOString(),
          width: 400,
          height: 800,
          latest_image_hash: 'hash-home',
          latest_app_version: '1.0.0',
        },
      ]);
    });

    it('returns an empty list when the project has no captures', async () => {
      const { service } = makeService();
      await expect(service.listScreens(USER, PROJECT)).resolves.toEqual({ screens: [] });
    });

    it('propagates a membership failure (does not read the DB)', async () => {
      const { service, prisma, assertMembership } = makeService();
      assertMembership.mockRejectedValue(new Error('forbidden'));
      await expect(service.listScreens(USER, PROJECT)).rejects.toThrow('forbidden');
      expect(prisma.screenCapture.findMany).not.toHaveBeenCalled();
    });
  });

  describe('deleteScreen (retake/delete)', () => {
    it('deletes the storage objects + metadata rows for all versions of a screen', async () => {
      const { service, prisma, storage } = makeService();
      prisma.screenCapture.findMany.mockResolvedValue([
        { storagePath: 'screens/p/Home/1.0.jpg' },
        { storagePath: 'screens/p/Home/1.1.jpg' },
      ]);

      await service.deleteScreen('proj-1', 'Home');

      expect(storage.delete).toHaveBeenCalledWith('screens/p/Home/1.0.jpg');
      expect(storage.delete).toHaveBeenCalledWith('screens/p/Home/1.1.jpg');
      expect(prisma.screenCapture.deleteMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1', screenName: 'Home' },
      });
    });

    it('scopes to a single app_version when given', async () => {
      const { service, prisma } = makeService();
      await service.deleteScreen('proj-1', 'Home', '1.2.0');
      expect(prisma.screenCapture.deleteMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1', screenName: 'Home', appVersion: '1.2.0' },
      });
    });

    it('never throws when a storage object is already gone', async () => {
      const { service, prisma, storage } = makeService();
      prisma.screenCapture.findMany.mockResolvedValue([{ storagePath: 'x' }]);
      storage.delete.mockRejectedValue(new Error('not found'));
      await expect(service.deleteScreen('proj-1', 'Home')).resolves.toBeUndefined();
      expect(prisma.screenCapture.deleteMany).toHaveBeenCalled();
    });
  });

  describe('getImage', () => {
    it('gates on membership and proxies the newest capture stream from storage', async () => {
      const { service, prisma, storage, assertMembership } = makeService();
      prisma.screenCapture.findFirst.mockResolvedValue({
        storagePath: 'screens/p/checkout/2.0.0.jpg',
        contentType: 'image/jpeg',
      });
      storage.getStream.mockResolvedValue({
        stream: Readable.from(Buffer.from([9, 9, 9])),
        contentType: 'image/jpeg',
        size: 3,
      });

      const result = await service.getImage(USER, PROJECT, 'checkout');

      expect(assertMembership).toHaveBeenCalledWith(USER, PROJECT);
      expect(prisma.screenCapture.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: PROJECT, screenName: 'checkout' },
          orderBy: { capturedAt: 'desc' },
        }),
      );
      expect(storage.getStream).toHaveBeenCalledWith('screens/p/checkout/2.0.0.jpg');
      expect(result.contentType).toBe('image/jpeg');
      expect((await streamToBuffer(result.stream)).equals(Buffer.from([9, 9, 9]))).toBe(true);
    });

    it('narrows by app_version and hash when provided', async () => {
      const { service, prisma, storage } = makeService();
      prisma.screenCapture.findFirst.mockResolvedValue({
        storagePath: 'screens/p/checkout/1.0.0.jpg',
        contentType: 'image/jpeg',
      });
      storage.getStream.mockResolvedValue({
        stream: Readable.from(Buffer.from([1])),
        contentType: 'image/jpeg',
        size: 1,
      });

      await service.getImage(USER, PROJECT, 'checkout', { appVersion: '2.0.0', hash: 'zzz' });

      expect(prisma.screenCapture.findFirst.mock.calls[0][0].where).toEqual({
        projectId: PROJECT,
        screenName: 'checkout',
        appVersion: '2.0.0',
        imageHash: 'zzz',
      });
    });

    it('throws 404 when no metadata row matches', async () => {
      const { service, storage } = makeService();
      await expect(service.getImage(USER, PROJECT, 'missing')).rejects.toMatchObject({
        problem: { status: 404 },
      });
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    it('throws 404 when metadata exists but the object is gone', async () => {
      const { service, prisma, storage } = makeService();
      prisma.screenCapture.findFirst.mockResolvedValue({
        storagePath: 'screens/p/checkout/1.0.0.jpg',
        contentType: 'image/jpeg',
      });
      storage.getStream.mockResolvedValue(null);
      await expect(service.getImage(USER, PROJECT, 'checkout')).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });
  });
});
