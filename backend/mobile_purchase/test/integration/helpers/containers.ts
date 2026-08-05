import { execSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

const BACKEND_DIR = path.resolve(__dirname, '..', '..', '..');

export interface StartedService<C> {
  container: C;
  url: string;
}

/** postgres:17-alpine with this service's Prisma migrations applied — self-contained, no
 * dependency on infra/docker-compose.yml's mobile-purchase-postgres service being up. */
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
