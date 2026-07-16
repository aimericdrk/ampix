import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Bound on the readiness probe. A dead dependency often hangs (half-open connection) rather
 * than refusing — the probe must 503, not wait forever.
 */
export const READINESS_PROBE_TIMEOUT_MS = 2500;

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: no I/O — only the process being wedged should trigger a restart. */
  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: real dependency probe; 503 keeps traffic away until the pool is usable. */
  @Get('ready')
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string; checks: { postgres: boolean } }> {
    const postgres = await this.check(async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    });
    const ready = postgres;
    if (!ready) {
      res.status(503);
    }
    return { status: ready ? 'ready' : 'unavailable', checks: { postgres } };
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
