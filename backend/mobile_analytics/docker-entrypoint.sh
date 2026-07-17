#!/bin/sh
set -e

# Apply pending Postgres migrations before boot so the container is self-provisioning against a
# fresh database.
#
# NOTE: fine for local + single-instance. The Cloud Run increment MUST move this to a dedicated
# one-shot migration step — multiple api/worker instances must not race `migrate deploy`.
echo "[entrypoint] applying database migrations…"
prisma migrate deploy --schema prisma/schema.prisma

echo "[entrypoint] starting backend…"
exec node dist/main.js
