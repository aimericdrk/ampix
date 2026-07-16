#!/bin/sh
set -e

# No models/migrations exist yet in this increment (health-only). `migrate deploy` is a no-op
# against an empty migrations directory, so this stays wired for when migrations land.
#
# NOTE: fine for local + single-instance. The Cloud Run increment MUST move this to a dedicated
# one-shot migration step — multiple instances must not race `migrate deploy`.
echo "[entrypoint] applying database migrations…"
prisma migrate deploy --schema prisma/schema.prisma

echo "[entrypoint] starting mobile-purchase backend…"
exec node dist/main.js
