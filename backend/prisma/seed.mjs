// Idempotent demo seed: creates one org → project → ingest token so the Flutter
// example app and HOW-TO-USE.md work out of the box. Run via `prisma db seed`
// (wired in package.json) or automatically by the root `pnpm dev`.
//
// The token is a fixed, well-known value (mam_ + 32 hex, matching the SDK token
// format). It is a LOCAL DEV credential only — never ship it.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_TOKEN = 'mam_00000000000000000000000000000000';

async function main() {
  const existing = await prisma.sdkToken.findUnique({ where: { token: DEMO_TOKEN } });
  if (existing) {
    console.log(`\n✔ demo ingest token already present: ${DEMO_TOKEN}\n`);
    return;
  }

  const org = await prisma.organization.create({ data: { name: 'Demo Org' } });
  const project = await prisma.project.create({
    data: { orgId: org.id, name: 'Demo App', timezone: 'UTC' },
  });
  await prisma.sdkToken.create({
    data: { projectId: project.id, token: DEMO_TOKEN, label: 'demo' },
  });

  console.log(
    `\n✔ seeded demo org/project + ingest token:\n` +
      `    token:  ${DEMO_TOKEN}\n` +
      `    ingest: http://localhost:8080/ingest/events\n` +
      `  The Flutter example (sdk/flutter_analytics/example) already uses this token.\n`,
  );
}

main()
  .catch((err) => {
    console.error('seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
