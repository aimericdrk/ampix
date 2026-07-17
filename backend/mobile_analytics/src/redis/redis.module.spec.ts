import type Redis from 'ioredis';
import { RedisModule } from './redis.module';

describe('RedisModule graceful shutdown', () => {
  it('quits the connection on application shutdown', async () => {
    const redis = { status: 'ready', quit: jest.fn().mockResolvedValue('OK') } as unknown as Redis;
    await new RedisModule(redis).onApplicationShutdown();
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });

  it('skips quit when the connection is already closed', async () => {
    const redis = { status: 'end', quit: jest.fn() } as unknown as Redis;
    await new RedisModule(redis).onApplicationShutdown();
    expect(redis.quit).not.toHaveBeenCalled();
  });
});
