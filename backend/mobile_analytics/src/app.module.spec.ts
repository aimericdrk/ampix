import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { REDIS } from './redis/redis.module';

/**
 * Boots the REAL module graph and asserts every provider resolves.
 *
 * This exists because of a specific outage: `AnalysisRunnerService` (ReportsModule) was given a new
 * dependency on `ExperimentsService`, which lives in AnalyticsModule — and AnalyticsModule listed it
 * under `providers` but not `exports`. A provider that is not exported is invisible to the importing
 * module, so Nest threw `UnknownDependenciesException` on startup. TypeScript cannot see this (the
 * import compiles fine), and every other test in this suite constructs services by hand with `new`,
 * so the entire unit suite passed against a binary that could not start.
 *
 * `.compile()` resolves the whole dependency graph without calling `onModuleInit`, so nothing here
 * opens a database or ClickHouse connection — Prisma connects in `onModuleInit` and the ClickHouse
 * client is lazy. Redis is the one provider whose factory dials out eagerly (`new Redis(url)`), so it
 * is overridden with a stub; that keeps the test hermetic and fast while still exercising every real
 * wiring decision.
 *
 * Anything that adds a cross-module dependency without exporting it fails HERE, in the default
 * `jest` run, instead of in a crash-looping pod.
 */
describe('AppModule wiring', () => {
  const ORIGINAL_ENV = process.env;

  beforeAll(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test', // lets the secrets below stay absent (see app-config's cross-field rules)
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      CLICKHOUSE_URL: 'http://localhost:8123',
      CLICKHOUSE_USER: 'default',
      CLICKHOUSE_PASSWORD: '',
      CLICKHOUSE_DB: 'analytics',
      REDIS_URL: 'redis://localhost:6379',
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('resolves every provider in the real graph', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue({ status: 'end', quit: jest.fn() })
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
