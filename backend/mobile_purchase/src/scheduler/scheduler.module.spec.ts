import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionExpirySweepService } from '../subscriptions/subscription-expiry-sweep.service';
import { SchedulerModule } from './scheduler.module';
import { ExpirySweepJob, EXPIRY_SWEEP_JOB_NAME } from './expiry-sweep.job';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 8090,
    databaseUrl: 'postgresql://u:p@localhost:5433/db',
    logLevel: 'info',
    analyticsInternalUrl: 'http://localhost:8088',
    schedulerEnabled: true,
    expirySweepCron: '*/5 * * * *',
    ...overrides,
  };
}

/**
 * D2 final-review gap: nothing previously booted `SchedulerModule` through real Nest DI —
 * `expiry-sweep.job.spec.ts` constructs `ExpirySweepJob` with `new`, and the e2e tests disable the
 * scheduler outright (see the D2 gate fix). This proves the module's own wiring — `APP_CONFIG`,
 * `SchedulerRegistry`, and `SubscriptionExpirySweepService` all resolve for `ExpirySweepJob`, and
 * the cron actually registers on `app.init()` — without touching a real database.
 */
describe('SchedulerModule (Nest DI boot)', () => {
  it('resolves its providers and registers the expiry-sweep cron on init', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, SchedulerModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(makeConfig())
      .overrideProvider(PrismaService)
      .useValue({} as unknown as PrismaService) // stub — the sweep never runs in this test
      .compile();

    expect(moduleRef.get(ExpirySweepJob)).toBeInstanceOf(ExpirySweepJob);
    expect(moduleRef.get(SubscriptionExpirySweepService)).toBeInstanceOf(SubscriptionExpirySweepService);

    await moduleRef.init();
    try {
      const registry = moduleRef.get(SchedulerRegistry);
      expect(registry.getCronJob(EXPIRY_SWEEP_JOB_NAME)).toBeDefined();
      registry.getCronJob(EXPIRY_SWEEP_JOB_NAME).stop();
    } finally {
      await moduleRef.close();
    }
  });
});
