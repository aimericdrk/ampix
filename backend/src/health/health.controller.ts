import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { REDIS } from '../redis/redis.module';

/**
 * Bound on each readiness probe. On Cloud Run/VPC a dead dependency often hangs
 * (half-open connection) rather than refusing — the probe must 503, not wait forever.
 */
export const READINESS_PROBE_TIMEOUT_MS = 2500;

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: no I/O — Cloud Run should only restart the instance if the process is wedged. */
  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: real dependency probes; 503 keeps traffic away until all pools are usable. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<{
    status: string;
    checks: { postgres: boolean; clickhouse: boolean; redis: boolean };
  }> {
    const [postgres, clickhouse, redis] = await Promise.all([
      this.check(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      this.check(async () => {
        if (!(await this.clickhouse.ping())) throw new Error('clickhouse ping failed');
      }),
      this.check(async () => {
        await this.redis.ping();
      }),
    ]);
    const ready = postgres && clickhouse && redis;
    if (!ready) {
      res.status(503);
    }
    return { status: ready ? 'ready' : 'unavailable', checks: { postgres, clickhouse, redis } };
  }

  /**
   * Resolves false if the probe fails or does not settle within READINESS_PROBE_TIMEOUT_MS.
   * The probe promise gets both handlers attached up front, so a rejection landing after
   * the timeout has already won is swallowed instead of surfacing as an unhandled rejection.
   */
  private async check(probe: () => Promise<void>): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), READINESS_PROBE_TIMEOUT_MS);
    });
    const attempt = Promise.resolve()
      .then(probe)
      .then(
        () => true,
        () => false,
      );
    try {
      return await Promise.race([attempt, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}
