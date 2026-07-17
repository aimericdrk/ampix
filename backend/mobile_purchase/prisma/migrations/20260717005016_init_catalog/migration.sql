-- CreateEnum
CREATE TYPE "AppPlatform" AS ENUM ('IOS', 'ANDROID', 'MACOS', 'AMAZON', 'WEB');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('AUTO_RENEWABLE_SUBSCRIPTION', 'NON_RENEWING_SUBSCRIPTION', 'CONSUMABLE', 'NON_CONSUMABLE');

-- CreateEnum
CREATE TYPE "PackageType" AS ENUM ('UNKNOWN', 'CUSTOM', 'LIFETIME', 'ANNUAL', 'SIX_MONTH', 'THREE_MONTH', 'TWO_MONTH', 'MONTHLY', 'WEEKLY');

-- CreateTable
CREATE TABLE "apps" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "AppPlatform" NOT NULL,
    "bundle_id" TEXT,
    "package_name" TEXT,
    "public_sdk_key" TEXT NOT NULL,
    "store_credentials" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "store_product_id" TEXT NOT NULL,
    "type" "ProductType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "price_cents" INTEGER,
    "currency" TEXT,
    "duration_iso8601" TEXT,
    "subscription_group_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_entitlements" (
    "product_id" UUID NOT NULL,
    "entitlement_id" UUID NOT NULL,

    CONSTRAINT "product_entitlements_pkey" PRIMARY KEY ("product_id","entitlement_id")
);

-- CreateTable
CREATE TABLE "offerings" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "offering_id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "package_type" "PackageType" NOT NULL,
    "product_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apps_public_sdk_key_key" ON "apps"("public_sdk_key");

-- CreateIndex
CREATE INDEX "apps_project_id_idx" ON "apps"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "apps_project_id_platform_bundle_id_key" ON "apps"("project_id", "platform", "bundle_id");

-- CreateIndex
CREATE UNIQUE INDEX "apps_project_id_platform_package_name_key" ON "apps"("project_id", "platform", "package_name");

-- CreateIndex
CREATE INDEX "products_project_id_idx" ON "products"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_app_id_store_product_id_key" ON "products"("app_id", "store_product_id");

-- CreateIndex
CREATE INDEX "entitlements_project_id_idx" ON "entitlements"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_project_id_identifier_key" ON "entitlements"("project_id", "identifier");

-- CreateIndex
CREATE INDEX "product_entitlements_entitlement_id_idx" ON "product_entitlements"("entitlement_id");

-- CreateIndex
CREATE INDEX "offerings_project_id_idx" ON "offerings"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "offerings_project_id_identifier_key" ON "offerings"("project_id", "identifier");

-- CreateIndex
CREATE INDEX "packages_product_id_idx" ON "packages"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "packages_offering_id_identifier_key" ON "packages"("offering_id", "identifier");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_entitlements" ADD CONSTRAINT "product_entitlements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_entitlements" ADD CONSTRAINT "product_entitlements_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index: at most one current offering per project. Prisma's schema DSL can't
-- express partial indexes, so this is hand-appended (see prisma/schema.prisma Offering model).
CREATE UNIQUE INDEX "offerings_one_current_per_project" ON "offerings" ("project_id") WHERE "is_current" = true;
