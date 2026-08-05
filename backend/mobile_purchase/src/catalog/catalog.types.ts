import type { PackageType, ProductType } from '../../generated/client';

export interface ResolvedPackage {
  identifier: string;
  packageType: PackageType;
  product: {
    storeProductId: string;
    type: ProductType;
    priceCents: number | null;
    currency: string | null;
    durationIso8601: string | null;
    entitlements: string[];
  };
}

export interface ResolvedOffering {
  identifier: string;
  metadata: unknown;
  packages: ResolvedPackage[];
}
