-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('owner', 'admin', 'analyst', 'viewer');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "created_by" UUID;

-- CreateTable
CREATE TABLE "project_memberships" (
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_memberships_pkey" PRIMARY KEY ("user_id","project_id")
);

-- CreateIndex
CREATE INDEX "project_memberships_project_id_idx" ON "project_memberships"("project_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: preserve today's access. Every current org member gets a project membership on every
-- project in their org. admin -> owner (they had full control), analyst -> analyst, viewer -> viewer.
INSERT INTO "project_memberships" ("user_id", "project_id", "role", "created_at")
SELECT m."user_id", p."id",
       (CASE m."role"
          WHEN 'admin'   THEN 'owner'
          WHEN 'analyst' THEN 'analyst'
          ELSE 'viewer'
        END)::"ProjectRole",
       now()
FROM "memberships" m
JOIN "projects" p ON p."org_id" = m."org_id"
ON CONFLICT ("user_id", "project_id") DO NOTHING;
