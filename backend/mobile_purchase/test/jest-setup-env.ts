// Runs once per test file, before the file's imports (jest `setupFiles`). Forces the
// @nestjs/schedule cron OFF in the test environment: the e2e suites boot the full `AppModule`,
// which registers `ExpirySweepJob`, and a background sweep firing mid-run holds a DB transaction
// while Testcontainers suites tear their containers down — causing spurious failures. Disabling
// the scheduler here keeps tests deterministic; the job's actual registration/enablement is
// covered by the isolated `expiry-sweep.job.spec.ts` wiring test (which sets the flag explicitly).
// A suite that genuinely needs the scheduler running can override `process.env.SCHEDULER_ENABLED`
// before booting its module.
process.env.SCHEDULER_ENABLED = 'false';
