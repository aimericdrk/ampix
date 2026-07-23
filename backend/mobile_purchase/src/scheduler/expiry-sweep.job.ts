import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { SubscriptionExpirySweepService } from '../subscriptions/subscription-expiry-sweep.service';

export const EXPIRY_SWEEP_JOB_NAME = 'subscription-expiry-sweep';

/**
 * The cron binding for the subscription-expiry sweep (design §1). Owns *when*, not *what*: it
 * registers a config-driven `CronJob` (so `EXPIRY_SWEEP_CRON` actually takes effect — a static
 * `@Cron` decorator cannot read runtime config) and delegates each tick to
 * `SubscriptionExpirySweepService`. Registers NOTHING when `SCHEDULER_ENABLED=false`. The handler
 * catches everything — a scheduled job must never throw out of its tick.
 */
@Injectable()
export class ExpirySweepJob implements OnModuleInit {
  private readonly logger = new Logger(ExpirySweepJob.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly registry: SchedulerRegistry,
    private readonly sweepService: SubscriptionExpirySweepService,
  ) {}

  onModuleInit(): void {
    if (this.config.schedulerEnabled === false) {
      this.logger.log('scheduler disabled (SCHEDULER_ENABLED=false); expiry sweep not registered');
      return;
    }
    const cron = this.config.expirySweepCron ?? '*/5 * * * *';
    const job = new CronJob(cron, () => {
      void this.run();
    });
    this.registry.addCronJob(EXPIRY_SWEEP_JOB_NAME, job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1]);
    job.start();
    this.logger.log(`expiry sweep registered: "${cron}"`);
  }

  /** One sweep tick. Catches everything: a scheduled handler must never throw out of its tick. */
  async run(): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = await this.sweepService.sweep();
      const durationMs = Date.now() - startedAt;
      const summary = { ...result, durationMs };
      if (result.expired === 0 && !result.skippedLock) {
        this.logger.debug(`expiry sweep: ${JSON.stringify(summary)}`);
      } else {
        this.logger.log(`expiry sweep: ${JSON.stringify(summary)}`);
      }
    } catch (error) {
      this.logger.error(
        `expiry sweep failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
