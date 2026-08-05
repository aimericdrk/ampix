// Read-only Postgres explorer for debugging (e.g. "the image is right in Firebase but wrong in the
// dashboard" → inspect the screen_captures metadata the read path resolves). Uses the backend's
// already-generated Prisma client + DATABASE_URL from backend/mobile_analytics/.env — no extra
// dependencies.
//
// Run it from anywhere — it resolves @prisma/client and DATABASE_URL from the
// backend/mobile_analytics workspace:
//     node scripts/db-explore.mjs <command> [args]        (from the repo root)
//     cd backend/mobile_analytics && node ../../scripts/db-explore.mjs <command> [args]
//
// Commands (all READ-ONLY — the script refuses anything that isn't a plain SELECT/WITH/EXPLAIN):
//     tables                        List every table with its row count.
//     describe <table>              Show a table's columns (name, type, nullable, default).
//     screens [projectId]           Dump screen_captures (the screenshot metadata), newest first.
//                                   Optionally filter to one project. This is the one for the
//                                   "wrong image in the dashboard" bug: check storage_path / image_hash
//                                   / width / height / app_version / captured_at vs updated_at.
//     screen <projectId> <name>     Every stored version of one screen (all app_versions).
//     projects                      List projects (id, name, org) so you can grab a projectId.
//     sql "<SELECT ...>"            Run an arbitrary read-only query.
//
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Resolve @prisma/client + .env from the backend/mobile_analytics workspace, regardless of the
// current directory.
// (ESM resolves bare specifiers relative to THIS file's dir, which has no node_modules of its own.)
const backendRequire = createRequire(new URL('../backend/mobile_analytics/package.json', import.meta.url));
const { PrismaClient } = backendRequire('@prisma/client');

const backendEnv = fileURLToPath(new URL('../backend/mobile_analytics/.env', import.meta.url));
try {
  process.loadEnvFile(backendEnv);
} catch {
  console.warn(`No env file at ${backendEnv} — relying on the real environment.`);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run this from the backend/mobile_analytics dir: cd backend/mobile_analytics && node ../../scripts/db-explore.mjs …');
  process.exit(1);
}

const prisma = new PrismaClient();

/** Guard: only allow a single read-only statement (SELECT/WITH/EXPLAIN/TABLE/VALUES), no chaining. */
function assertReadOnly(sql) {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .trim()
    .replace(/;+\s*$/, ''); // one optional trailing semicolon
  if (stripped.includes(';')) {
    throw new Error('Only a single statement is allowed (no ";" chaining).');
  }
  const first = stripped.split(/\s+/, 1)[0]?.toUpperCase() ?? '';
  if (!['SELECT', 'WITH', 'EXPLAIN', 'TABLE', 'VALUES'].includes(first)) {
    throw new Error(`Refused: "${first}" is not read-only. Only SELECT/WITH/EXPLAIN/TABLE/VALUES are allowed.`);
  }
  return stripped;
}

/** Print rows as a table, collapsing bigint (row counts) to Number so console.table renders them. */
function printRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('(no rows)');
    return;
  }
  const normalized = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : v,
      ]),
    ),
  );
  console.table(normalized);
  console.log(`${normalized.length} row(s).`);
}

async function cmdTables() {
  const tables = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const withCounts = [];
  for (const { table_name } of tables) {
    const [{ count }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::bigint AS count FROM "${table_name}"`,
    );
    withCounts.push({ table: table_name, rows: Number(count) });
  }
  printRows(withCounts);
}

async function cmdDescribe(table) {
  if (!table) throw new Error('Usage: describe <table>');
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    table,
  );
  printRows(cols);
}

async function cmdScreens(projectId) {
  const rows = await prisma.screenCapture.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: [{ screenName: 'asc' }, { capturedAt: 'desc' }],
  });
  printRows(
    rows.map((r) => ({
      screen_name: r.screenName,
      app_version: r.appVersion,
      width: r.width,
      height: r.height,
      image_hash: r.imageHash,
      storage_path: r.storagePath,
      captured_at: r.capturedAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
      project_id: r.projectId,
    })),
  );
  console.log(
    '\nTip: the dashboard read path serves the NEWEST (captured_at desc) version per screen. If image_hash / width / height look right here but the dashboard image is wrong, it is a client-cache / display issue, not the DB.',
  );
}

async function cmdScreen(projectId, screenName) {
  if (!projectId || !screenName) throw new Error('Usage: screen <projectId> <screenName>');
  const rows = await prisma.screenCapture.findMany({
    where: { projectId, screenName },
    orderBy: { capturedAt: 'desc' },
  });
  printRows(
    rows.map((r) => ({
      app_version: r.appVersion,
      width: r.width,
      height: r.height,
      image_hash: r.imageHash,
      storage_path: r.storagePath,
      captured_at: r.capturedAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    })),
  );
}

async function cmdProjects() {
  const rows = await prisma.project.findMany({
    select: { id: true, name: true, orgId: true },
    orderBy: { name: 'asc' },
  });
  printRows(rows);
}

async function cmdSql(sql) {
  if (!sql) throw new Error('Usage: sql "<SELECT ...>"');
  const safe = assertReadOnly(sql);
  const rows = await prisma.$queryRawUnsafe(safe);
  printRows(rows);
}

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'tables':
      await cmdTables();
      break;
    case 'describe':
      await cmdDescribe(args[0]);
      break;
    case 'screens':
      await cmdScreens(args[0]);
      break;
    case 'screen':
      await cmdScreen(args[0], args[1]);
      break;
    case 'projects':
      await cmdProjects();
      break;
    case 'sql':
      await cmdSql(args[0]);
      break;
    default:
      console.log(
        [
          'Read-only Postgres explorer. Run from backend/:  cd backend && node ../scripts/db-explore.mjs <command>',
          '',
          '  tables                     list tables + row counts',
          '  describe <table>           show a table\'s columns',
          '  screens [projectId]        dump screen_captures (screenshot metadata), newest first',
          '  screen <projectId> <name>  all stored versions of one screen',
          '  projects                   list projects (grab a projectId)',
          '  sql "<SELECT ...>"         run an arbitrary read-only query',
        ].join('\n'),
      );
  }
} catch (err) {
  console.error('\nError:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
