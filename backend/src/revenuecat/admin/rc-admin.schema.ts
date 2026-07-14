import { z } from 'zod';

export const rcUpsertSchema = z
  .object({
    api_key: z.string().trim().min(1).max(200).optional(),
    rc_project_id: z.string().trim().min(1).max(100).optional(),
    sandbox_mode: z.boolean().optional(),
  })
  .strict();

export type RcUpsertInput = z.infer<typeof rcUpsertSchema>;
