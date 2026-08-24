// Admin console migrate step (design §3.8, runs in the myampix-admin-migrate image):
//   1. create the `admin_console` database if it does not exist (the Compose POSTGRES_USER is superuser)
//   2. prisma migrate deploy
//   3. seed the default admin account — ONLY when the AdminUser table is empty
// Idempotent; exits non-zero on any failure so the Helm hook aborts the release.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] DATABASE_URL is required');
  process.exit(1);
}

const target = new URL(url);
const dbName = target.pathname.replace(/^\//, '') || 'admin_console';

// 1 — bootstrap the database via the maintenance DB on the same server.
{
  const maint = new URL(url);
  maint.pathname = '/postgres';
  const client = new pg.Client({ connectionString: maint.toString() });
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) {
    // CREATE DATABASE cannot be parameterized; dbName comes from our own DATABASE_URL. Quote defensively.
    await client.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
    console.log(`[migrate] created database ${dbName}`);
  } else {
    console.log(`[migrate] database ${dbName} already exists`);
  }
  await client.end();
}

// 2 — apply migrations.
{
  const res = spawnSync('node_modules/.bin/prisma', ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    stdio: 'inherit',
    env: { ...process.env, CHECKPOINT_DISABLE: '1' },
  });
  if (res.status !== 0) {
    console.error('[migrate] prisma migrate deploy failed');
    process.exit(res.status ?? 1);
  }
}

// 3 — seed the default account iff the table is empty (never touches a non-empty table).
{
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM "AdminUser"');
  if (rows[0].n === 0) {
    const email = process.env.ADMIN_DEFAULT_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_DEFAULT_PASSWORD;
    if (!email || !password) {
      console.error('[migrate] AdminUser is empty and ADMIN_DEFAULT_EMAIL/ADMIN_DEFAULT_PASSWORD are not set — the console would be unusable. Aborting.');
      await client.end();
      process.exit(1);
    }
    if (password.length < 12) {
      console.error('[migrate] ADMIN_DEFAULT_PASSWORD must be at least 12 characters');
      await client.end();
      process.exit(1);
    }
    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await client.query(
      `INSERT INTO "AdminUser" (id, email, "displayName", "passwordHash", "mustChangePassword", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, true, now(), now())`,
      [randomUUID(), email, 'Default Admin', hash],
    );
    console.log(`[migrate] seeded default admin account ${email} (password change forced at first login)`);
  } else {
    console.log('[migrate] AdminUser not empty — no seeding');
  }
  await client.end();
}
console.log('[migrate] done');
