-- CreateTable
CREATE TABLE "screen_captures" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "screen_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "app_version" TEXT NOT NULL,
    "image_hash" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screen_captures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "screen_captures_project_id_screen_name_idx" ON "screen_captures"("project_id", "screen_name");

-- CreateIndex
CREATE UNIQUE INDEX "screen_captures_project_id_screen_name_app_version_key" ON "screen_captures"("project_id", "screen_name", "app_version");

-- AddForeignKey
ALTER TABLE "screen_captures" ADD CONSTRAINT "screen_captures_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
