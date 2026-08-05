import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.$-]+$/, 'invalid identifier');

export const createAppSchema = z
  .object({
    name: z.string().min(1).max(200),
    platform: z.enum(['IOS', 'ANDROID', 'MACOS', 'AMAZON', 'WEB']),
    bundleId: z.string().min(1).optional(),
    packageName: z.string().min(1).optional(),
  })
  .refine((v) => (v.platform === 'IOS' ? !!v.bundleId : true), { message: 'iOS apps require bundleId' })
  .refine((v) => (v.platform === 'ANDROID' ? !!v.packageName : true), { message: 'Android apps require packageName' });

export const createProductSchema = z.object({
  appId: z.string().uuid(),
  storeProductId: z.string().min(1).max(256),
  type: z.enum(['AUTO_RENEWABLE_SUBSCRIPTION', 'NON_RENEWING_SUBSCRIPTION', 'CONSUMABLE', 'NON_CONSUMABLE']),
  displayName: z.string().min(1).max(256),
  priceCents: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  durationIso8601: z.string().min(2).max(16).optional(),
  subscriptionGroupId: z.string().min(1).optional(),
});

export const updateProductSchema = z
  .object({
    displayName: z.string().min(1).max(256).optional(),
    priceCents: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    durationIso8601: z.string().min(2).max(16).optional(),
    subscriptionGroupId: z.string().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });

export const createEntitlementSchema = z.object({
  identifier,
  displayName: z.string().min(1).max(256),
});

export const updateEntitlementSchema = z
  .object({
    displayName: z.string().min(1).max(256).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });

export const attachEntitlementSchema = z.object({ entitlementId: z.string().uuid() });

export const createOfferingSchema = z.object({
  identifier,
  displayName: z.string().min(1).max(256),
  isCurrent: z.boolean().optional(),
  metadata: z.unknown().optional(),
});

export const updateOfferingSchema = z
  .object({
    displayName: z.string().min(1).max(256).optional(),
    metadata: z.unknown().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });

export const createPackageSchema = z.object({
  identifier,
  packageType: z.enum(['UNKNOWN', 'CUSTOM', 'LIFETIME', 'ANNUAL', 'SIX_MONTH', 'THREE_MONTH', 'TWO_MONTH', 'MONTHLY', 'WEEKLY']),
  productId: z.string().uuid(),
  sortOrder: z.number().int().optional(),
});

export const updatePackageSchema = z
  .object({
    packageType: z
      .enum(['UNKNOWN', 'CUSTOM', 'LIFETIME', 'ANNUAL', 'SIX_MONTH', 'THREE_MONTH', 'TWO_MONTH', 'MONTHLY', 'WEEKLY'])
      .optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
