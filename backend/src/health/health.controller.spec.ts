import type { Response } from 'express';
import type Redis from 'ioredis';
import type { ClickHouseService } from '../clickhouse/clickhouse.service';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

function makeController(
  overrides: { pgFails?: boolean; chDown?: boolean; redisFails?: boolean } = {},
) {
  const prisma = {
    $queryRaw: overrides.pgFails
      ? jest.fn().mockRejectedValue(new Error('down'))
      : jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  } as unknown as PrismaService;
  const clickhouse = {
    ping: jest.fn().mockResolvedValue(!overrides.chDown),
  } as unknown as ClickHouseService;
  const redis = {
    ping: overrides.redisFails
      ? jest.fn().mockRejectedValue(new Error('down'))
      : jest.fn().mockResolvedValue('PONG'),
  } as unknown as Redis;
  return new HealthController(prisma, clickhouse, redis);
}

function mockRes(): { res: Response; statusCalls: number[] } {
  const statusCalls: number[] = [];
  const res = {
    status(code: number) {
      statusCalls.push(code);
      return res;
    },
  } as unknown as Response;
  return { res, statusCalls };
}

describe('HealthController', () => {
  it('live always returns ok without touching dependencies', () => {
    expect(makeController().live()).toEqual({ status: 'ok' });
  });

  it('ready reports all checks true when every dependency is up', async () => {
    const { res, statusCalls } = mockRes();
    const body = await makeController().ready(res);
    expect(body).toEqual({
      status: 'ready',
      checks: { postgres: true, clickhouse: true, redis: true },
    });
    expect(statusCalls).toEqual([]);
  });

  it('ready returns 503 when clickhouse ping fails', async () => {
    const { res, statusCalls } = mockRes();
    const body = await makeController({ chDown: true }).ready(res);
    expect(body.status).toBe('unavailable');
    expect(body.checks.clickhouse).toBe(false);
    expect(statusCalls).toEqual([503]);
  });

  it('ready returns 503 when postgres is down', async () => {
    const { res, statusCalls } = mockRes();
    const body = await makeController({ pgFails: true }).ready(res);
    expect(body.checks.postgres).toBe(false);
    expect(statusCalls).toEqual([503]);
  });

  it('ready returns 503 when redis is down', async () => {
    const { res, statusCalls } = mockRes();
    const body = await makeController({ redisFails: true }).ready(res);
    expect(body.checks.redis).toBe(false);
    expect(statusCalls).toEqual([503]);
  });
});
