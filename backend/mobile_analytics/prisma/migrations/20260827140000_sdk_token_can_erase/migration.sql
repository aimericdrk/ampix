-- Per-project authorization for end-user erasure, replacing the single global ERASURE_API_KEY.
-- A `server` token may now be minted with the erase capability; the shared secret is gone, so no
-- key has to be handed to another project's members to let them delete their own users' data.
--
-- DEFAULT false is the whole backfill: every token that already exists keeps ingest-only rights,
-- so no credential silently gains delete power from this migration. The CHECK is what makes the
-- capability safe — a `client` token ships inside the app and is extractable, so it can never
-- carry it, in the API or by any direct write to this table.

-- AlterTable
ALTER TABLE "sdk_tokens" ADD COLUMN "can_erase" BOOLEAN NOT NULL DEFAULT false;

-- Capability is only ever grantable to a server token.
ALTER TABLE "sdk_tokens"
  ADD CONSTRAINT "sdk_tokens_can_erase_server_only"
  CHECK (NOT "can_erase" OR "source" = 'server');
