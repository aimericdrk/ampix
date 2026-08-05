import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { AppConfig } from '../config/app-config';
import type { SubscriptionExpirySweepService, ExpirySweepResult } from '../subscriptions/subscription-expiry-sweep.service';
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

const okResult: ExpirySweepResult = { candidates: 3, expired: 3, skippedLock: false, batches: 1, capped: false };

function makeSweep(impl: () => Promise<ExpirySweepResult>): SubscriptionExpirySweepService {
  return { sweep: jest.fn(impl) } as unknown as SubscriptionExpirySweepService;
}

describe('ExpirySweepJob', () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    registry = new SchedulerRegistry();
  });

  it('registers the cron job when the scheduler is enabled', () => {
    const job = new ExpirySweepJob(makeConfig({ schedulerEnabled: true }), registry, makeSweep(async () => okResult));
    job.onModuleInit();
    expect(registry.getCronJob(EXPIRY_SWEEP_JOB_NAME)).toBeDefined();
    registry.getCronJob(EXPIRY_SWEEP_JOB_NAME).stop();
  });

  it('registers NOTHING when the scheduler is disabled', () => {
    const job = new ExpirySweepJob(makeConfig({ schedulerEnabled: false }), registry, makeSweep(async () => okResult));
    job.onModuleInit();
    expect(() => registry.getCronJob(EXPIRY_SWEEP_JOB_NAME)).toThrow();
  });

  it('run() swallows a thrown sweep error and logs it (never rejects)', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const job = new ExpirySweepJob(
      makeConfig(),
      registry,
      makeSweep(async () => {
        throw new Error('boom');
      }),
    );
    await expect(job.run()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('run() logs a summary from the sweep result', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const job = new ExpirySweepJob(makeConfig(), registry, makeSweep(async () => okResult));
    await job.run();
    // expired > 0 → log level, not debug
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
    debugSpy.mockRestore();
  });
});
