import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { REDIS } from '../redis/redis.module';

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
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string; checks: Record<string, boolean> }> {
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

  private async check(probe: () => Promise<void>): Promise<boolean> {
    try {
      await probe();
      return true;
    } catch {
      return false;
    }
  }
}
