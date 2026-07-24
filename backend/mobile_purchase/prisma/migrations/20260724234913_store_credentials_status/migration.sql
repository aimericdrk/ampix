-- AlterTable
ALTER TABLE "apps" ADD COLUMN     "store_credentials_live_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "store_credentials_verified_at" TIMESTAMP(3);
