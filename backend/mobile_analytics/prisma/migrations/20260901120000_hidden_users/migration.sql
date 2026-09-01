-- `hidden_users` — the reversible half of the dashboard's "remove this user" action. A hidden user
-- drops out of the audience surfaces (Users list, user profile, live feed, attribution) while their
-- events stay on disk; the irreversible half is ErasureService's ClickHouse + Postgres wipe, which
-- needs no table because it leaves nothing behind.
--
-- `distinct_id` is the CANONICAL id (contracts §17) resolved at hide time, so hiding someone by one
-- of their anon ids hides the whole merged identity rather than half of it.

-- CreateTable
CREATE TABLE "hidden_users" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "distinct_id" TEXT NOT NULL,
    "hidden_by" UUID,
    "hidden_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hidden_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hidden_users_project_id_idx" ON "hidden_users"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "hidden_users_project_id_distinct_id_key" ON "hidden_users"("project_id", "distinct_id");

-- AddForeignKey
ALTER TABLE "hidden_users" ADD CONSTRAINT "hidden_users_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hidden_users" ADD CONSTRAINT "hidden_users_hidden_by_fkey" FOREIGN KEY ("hidden_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
