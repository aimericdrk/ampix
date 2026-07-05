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

interface PrismaMock {
  screenCapture: {
    upsert: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
}

interface StorageMock {
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

function makeService(screenshotMaxKb = 512) {
  const prismaMock: PrismaMock = {
    screenCapture: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const storageMock: StorageMock = {
    put: jest.fn().mockResolvedValue(undefined),
    getStream: jest.fn().mockResolvedValue(null),
    signedUrl: jest.fn().mockResolvedValue('memory://x'),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const assertMembership = jest.fn().mockResolvedValue(undefined);
  const prisma = prismaMock as unknown as PrismaService;
  const projects = { assertMembership } as unknown as ProjectsService;
  const config = { screenshotMaxKb } as AppConfig;
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
  it('builds a deterministic, URI-encoded object path', () => {
    expect(screenshotObjectPath(PROJECT, 'checkout', '1.0.0')).toBe(
      `screens/${PROJECT}/checkout/1.0.0.jpg`,
    );
  });

  it('encodes unsafe characters so a segment cannot escape the prefix', () => {
    expect(screenshotObjectPath(PROJECT, 'a/b', '1.0')).toBe(
      `screens/${PROJECT}/a%2Fb/1.0.jpg`,
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

      const expectedPath = screenshotObjectPath(PROJECT, 'checkout', '1.0.0');
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
  });

  describe('listScreens', () => {
    it('gates on membership and folds versions into capture_count with latest metadata', async () => {
      const { service, prisma, assertMembership } = makeService();
      const newer = new Date('2026-07-02T10:00:00.000Z');
      const older = new Date('2026-07-01T10:00:00.000Z');
      prisma.screenCapture.findMany.mockResolvedValue([
        { screenName: 'checkout', width: 640, height: 1280, capturedAt: newer },
        { screenName: 'checkout', width: 320, height: 640, capturedAt: older },
        { screenName: 'home', width: 400, height: 800, capturedAt: older },
      ]);

      const result = await service.listScreens(USER, PROJECT);

      expect(assertMembership).toHaveBeenCalledWith(USER, PROJECT);
      expect(prisma.screenCapture.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: PROJECT } }),
      );
      // Neither bytes nor a storage path are selected (cheap metadata read).
      const select = prisma.screenCapture.findMany.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('storagePath');
      expect(result.screens).toEqual([
        {
          screen_name: 'checkout',
          capture_count: 2,
          latest_captured_at: newer.toISOString(),
          width: 640,
          height: 1280,
        },
        {
          screen_name: 'home',
          capture_count: 1,
          latest_captured_at: older.toISOString(),
          width: 400,
          height: 800,
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
