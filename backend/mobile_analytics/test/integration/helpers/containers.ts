import { execSync } from 'node:child_process';
import path from 'node:path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

const BACKEND_DIR = path.resolve(__dirname, '..', '..', '..');

export interface StartedService<C> {
  container: C;
  url: string;
}

/** postgres:17-alpine with the Prisma migrations applied (contracts §6). */
export async function startPostgresContainer(): Promise<
  StartedService<StartedPostgreSqlContainer>
> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
  return { container, url };
}

/** redis:7-alpine, no auth (contracts §2). */
export async function startRedisContainer(): Promise<StartedService<StartedTestContainer>> {
  const container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
  return { container, url: `redis://${container.getHost()}:${container.getMappedPort(6379)}` };
}

/** clickhouse/clickhouse-server:24.8 with contracts §2 credentials. */
export async function startClickHouseContainer(): Promise<StartedService<StartedTestContainer>> {
  const container = await new GenericContainer('clickhouse/clickhouse-server:24.8')
    .withEnvironment({
      CLICKHOUSE_USER: 'default',
      CLICKHOUSE_PASSWORD: 'myampix_dev',
      CLICKHOUSE_DB: 'analytics',
    })
    .withExposedPorts(8123)
    .withWaitStrategy(Wait.forHttp('/ping', 8123).forStatusCode(200))
    .start();
  return { container, url: `http://${container.getHost()}:${container.getMappedPort(8123)}` };
}
