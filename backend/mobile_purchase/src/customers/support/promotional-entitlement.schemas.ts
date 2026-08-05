import { z } from 'zod';
import { PROMOTIONAL_DURATIONS } from './promotional-duration';

export const grantPromotionalEntitlementSchema = z.object({
  entitlementId: z.string().uuid(),
  duration: z.enum(PROMOTIONAL_DURATIONS),
  note: z.string().min(1).max(2000).optional(),
});
