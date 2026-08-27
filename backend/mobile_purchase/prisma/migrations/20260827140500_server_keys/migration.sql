-- Per-project backend credentials, replacing the global ERASURE_API_KEY on
-- DELETE /v1/subscribers/:appUserId. The shared secret could not be handed to one project's
-- backend without handing it erasure rights across every project; a server key is scoped to the
-- project that minted it, and revoking it affects nobody else.
--
-- Nothing is backfilled: the endpoint was disabled in every environment (the guard fails closed
-- when the key is unset), so there is no live caller to keep working.

-- CreateTable
CREATE TABLE "server_keys" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "can_erase" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "server_keys_key_key" ON "server_keys"("key");

-- CreateIndex
CREATE INDEX "server_keys_project_id_idx" ON "server_keys"("project_id");
