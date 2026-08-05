import { Environment, OwnershipType, ProductType } from '../../../generated/client';

/**
 * Apple's decoded `type` string (design §1.1 nested `signedTransactionInfo`,
 * `"Auto-Renewable Subscription" | "Non-Consumable" | "Consumable" | "Non-Renewing Subscription"`)
 * to the catalog's `ProductType` enum, reused verbatim on `Transaction.type` (design §2).
 * Falls back to `NON_CONSUMABLE` — the option with the fewest lifecycle implications — when
 * Apple's string is absent or unrecognized; in practice every real ASSN v2 transaction sets it.
 */
export function mapAppleTransactionType(appleType: string | undefined): ProductType {
  switch (appleType) {
    case 'Auto-Renewable Subscription':
      return ProductType.AUTO_RENEWABLE_SUBSCRIPTION;
    case 'Non-Renewing Subscription':
      return ProductType.NON_RENEWING_SUBSCRIPTION;
    case 'Consumable':
      return ProductType.CONSUMABLE;
    case 'Non-Consumable':
      return ProductType.NON_CONSUMABLE;
    default:
      return ProductType.NON_CONSUMABLE;
  }
}

/**
 * Apple's raw `data.environment` string (`"Sandbox" | "Production"` on a genuine notification,
 * design §1.1) to the catalog's `Environment` enum. Anything other than exactly `"Production"`
 * defaults to `SANDBOX` — an unrecognized value is never silently treated as Production.
 */
export function mapAppleEnvironment(raw: string): Environment {
  return raw === 'Production' ? Environment.PRODUCTION : Environment.SANDBOX;
}

/**
 * Apple's `inAppOwnershipType` to the persisted `Subscription.ownershipType` column (M2b).
 * Defaults to `PURCHASED` — matching the Prisma column default — when Apple omits it.
 */
export function mapOwnershipType(raw: 'PURCHASED' | 'FAMILY_SHARED' | undefined): OwnershipType {
  return raw === 'FAMILY_SHARED' ? OwnershipType.FAMILY_SHARED : OwnershipType.PURCHASED;
}
