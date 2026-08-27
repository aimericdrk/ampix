import { z } from 'zod';
import { eventSourceSchema } from '@myampix/contracts';

const MAX_NAME_LENGTH = 200;
const MAX_TIMEZONE_LENGTH = 64;
const MAX_LABEL_LENGTH = 200;

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  timezone: z.string().trim().min(1).max(MAX_TIMEZONE_LENGTH).optional(),
});
export type CreateProjectDto = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
    timezone: z.string().trim().min(1).max(MAX_TIMEZONE_LENGTH).optional(),
  })
  .refine((v) => v.name !== undefined || v.timezone !== undefined, {
    message: 'at least one of name or timezone must be provided',
  });
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;

/**
 * `source` decides how every event sent with this token is classified, and is fixed for the token's
 * lifetime. Omitted means `client` — the pre-existing behaviour, so old callers keep working.
 */
export const createTokenSchema = z
  .object({
    label: z.string().trim().min(1).max(MAX_LABEL_LENGTH).optional(),
    source: eventSourceSchema.optional(),
    /**
     * Grants this token the end-user erasure capability (DELETE /ingest/users/:distinctId).
     * Server-only and refused on a `client` token: that one ships inside the app where anyone can
     * extract it, so it must never authorize a destructive delete. Fixed for the token's lifetime,
     * like `source` — rotation mints a replacement carrying the same capability.
     */
    can_erase: z.boolean().optional(),
  })
  .refine((v) => v.can_erase !== true || v.source === 'server', {
    path: ['can_erase'],
    message: 'can_erase requires source "server"',
  });
export type CreateTokenDto = z.infer<typeof createTokenSchema>;

/**
 * POST /api/v1/projects/:projectId/data/purge body. Each scope the caller opts into is wiped;
 * at least one must be selected. Owner-only, irreversible (enforced at the controller).
 */
export const purgeDataSchema = z.object({
  scopes: z
    .object({
      analytics: z.boolean().optional(),
      revenuecat: z.boolean().optional(),
      saved: z.boolean().optional(),
    })
    .refine((s) => s.analytics === true || s.revenuecat === true || s.saved === true, {
      message: 'at least one scope must be selected',
    }),
});
export type PurgeDataDto = z.infer<typeof purgeDataSchema>;
