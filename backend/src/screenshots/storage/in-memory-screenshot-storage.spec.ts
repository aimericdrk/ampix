import { Readable } from 'node:stream';
import { InMemoryScreenshotStorage } from './in-memory-screenshot-storage';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

describe('InMemoryScreenshotStorage', () => {
  const path = 'screens/p1/home/1.0.0.jpg';
  const bytes = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);

  it('round-trips put -> getStream with the exact bytes and content type', async () => {
    const store = new InMemoryScreenshotStorage();
    await store.put(path, bytes, 'image/jpeg');

    const obj = await store.getStream(path);
    expect(obj).not.toBeNull();
    expect(obj!.contentType).toBe('image/jpeg');
    expect(obj!.size).toBe(bytes.length);
    expect((await streamToBuffer(obj!.stream)).equals(bytes)).toBe(true);
  });

  it('put overwrites an existing object at the same path', async () => {
    const store = new InMemoryScreenshotStorage();
    await store.put(path, Buffer.from([1]), 'image/jpeg');
    await store.put(path, Buffer.from([2, 3]), 'image/jpeg');

    const obj = await store.getStream(path);
    expect((await streamToBuffer(obj!.stream)).equals(Buffer.from([2, 3]))).toBe(true);
  });

  it('copies the buffer so a later caller mutation cannot corrupt stored bytes', async () => {
    const store = new InMemoryScreenshotStorage();
    const mutable = Buffer.from([9, 9]);
    await store.put(path, mutable, 'image/jpeg');
    mutable[0] = 0;

    const obj = await store.getStream(path);
    expect((await streamToBuffer(obj!.stream)).equals(Buffer.from([9, 9]))).toBe(true);
  });

  it('returns null for a missing object and after delete', async () => {
    const store = new InMemoryScreenshotStorage();
    expect(await store.getStream('nope')).toBeNull();

    await store.put(path, bytes, 'image/jpeg');
    await store.delete(path);
    expect(await store.getStream(path)).toBeNull();
    // delete is a no-op when already gone.
    await expect(store.delete(path)).resolves.toBeUndefined();
  });

  it('signedUrl returns a stable pseudo-URL for the path', async () => {
    const store = new InMemoryScreenshotStorage();
    expect(await store.signedUrl(path)).toBe(`memory://screenshots/${path}`);
  });
});
