-- M5b: a store token (Apple appAccountToken / Google obfuscatedExternalAccountId) must map to at
-- most ONE Customer per project — `CustomersService.bindStoreToken` fails closed (409) on
-- conflict. Plain (non-partial) unique indexes are sufficient here: Postgres never treats two
-- NULLs as colliding on a unique index, so customers with no token bound yet never conflict with
-- each other. These composite indexes also cover `findByStoreToken`'s `(project_id, token)`
-- lookup, so the old single-column indexes below are superseded and dropped.

-- DropIndex
DROP INDEX "customers_apple_app_account_token_idx";

-- DropIndex
DROP INDEX "customers_google_obfuscated_account_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "customers_project_id_apple_app_account_token_key" ON "customers"("project_id", "apple_app_account_token");

-- CreateIndex
CREATE UNIQUE INDEX "customers_project_id_google_obfuscated_account_id_key" ON "customers"("project_id", "google_obfuscated_account_id");
