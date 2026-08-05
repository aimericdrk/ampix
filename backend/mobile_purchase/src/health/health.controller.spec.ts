import type { Response } from 'express';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthController, READINESS_PROBE_TIMEOUT_MS } from './health.controller';

function makeController(overrides: { pgFails?: boolean } = {}) {
  const prisma = {
    $queryRaw: overrides.pgFails
      ? jest.fn().mockRejectedValue(new Error('down'))
      : jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  } as unknown as PrismaService;
  return new HealthController(prisma);
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

  it('ready reports postgres true when the probe resolves', async () => {
    const { res, statusCalls } = mockRes();
    const body = await makeController().ready(res);
    expect(body).toEqual({ status: 'ready', checks: { postgres: true } });
    expect(statusCalls).toEqual([]);
  });

  it('ready returns 503 when postgres is down', async () => {
    const { res, statusCalls } = mockRes();
    const body = await makeController({ pgFails: true }).ready(res);
    expect(body).toEqual({ status: 'unavailable', checks: { postgres: false } });
    expect(statusCalls).toEqual([503]);
  });

  it('ready returns 503 within the probe timeout when postgres hangs instead of failing', async () => {
    jest.useFakeTimers();
    try {
      const prisma = {
        // Half-open connection: the query never settles — neither resolves nor rejects.
        $queryRaw: jest.fn().mockReturnValue(new Promise(() => {})),
      } as unknown as PrismaService;
      const { res, statusCalls } = mockRes();

      const pending = new HealthController(prisma).ready(res);
      await jest.advanceTimersByTimeAsync(READINESS_PROBE_TIMEOUT_MS);
      const body = await pending;

      expect(body).toEqual({ status: 'unavailable', checks: { postgres: false } });
      expect(statusCalls).toEqual([503]);
    } finally {
      jest.useRealTimers();
    }
  });
});
