-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('PURCHASED', 'FAMILY_SHARED');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "ownership_type" "OwnershipType" NOT NULL DEFAULT 'PURCHASED';
