-- Attribute ingested events to a client (device/browser) or a server (your own backend), decided
-- by the token the batch was sent with. The column carries a DEFAULT, so every token that already
-- exists — including each project's primary ingest token — becomes `client` without a separate
-- backfill statement: client is what all ingest traffic was before server tokens existed.

-- CreateEnum
CREATE TYPE "IngestSource" AS ENUM ('client', 'server');

-- AlterTable
ALTER TABLE "sdk_tokens" ADD COLUMN "source" "IngestSource" NOT NULL DEFAULT 'client';
