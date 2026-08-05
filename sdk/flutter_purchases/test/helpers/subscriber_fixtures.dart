/// Spec §3-shaped `GET /v1/subscribers/:appUserId` response envelopes for the
/// facade orchestration tests (driven through MockClient). Parsing itself is
/// P3.1 (`CustomerInfo.fromJson`) / P3.2 (`PurchasesApiClient`); these bodies
/// match the mobile_purchase contract the design pins.
const String subscriberJsonEmpty =
    '{"customerInfo":{"entitlements":{"all":{},"active":{}},'
    '"subscriptions":[],"firstSeen":"2026-07-17T10:00:00Z",'
    '"managementURL":null}}';

const String subscriberJsonActive =
    '{"customerInfo":{"entitlements":{"all":{"premium":{"isActive":true,'
    '"willRenew":true,"periodType":"normal",'
    '"latestPurchaseDate":"2026-07-01T00:00:00Z",'
    '"originalPurchaseDate":"2026-01-01T00:00:00Z",'
    '"expirationDate":"2026-08-01T00:00:00Z","store":"app_store",'
    '"productIdentifier":"premium_monthly","ownershipType":"PURCHASED"}},'
    '"active":{"premium":{"isActive":true,"willRenew":true,'
    '"periodType":"normal","latestPurchaseDate":"2026-07-01T00:00:00Z",'
    '"originalPurchaseDate":"2026-01-01T00:00:00Z",'
    '"expirationDate":"2026-08-01T00:00:00Z","store":"app_store",'
    '"productIdentifier":"premium_monthly","ownershipType":"PURCHASED"}}},'
    '"subscriptions":[{"storeProductId":"premium_monthly","isActive":true,'
    '"expirationDate":"2026-08-01T00:00:00Z"}],'
    '"firstSeen":"2026-01-01T00:00:00Z",'
    '"managementURL":"https://apps.apple.com/account/subscriptions"}}';
