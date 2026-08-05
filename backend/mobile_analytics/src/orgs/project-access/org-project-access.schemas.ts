import { z } from 'zod';

export const setProjectAccessSchema = z.object({
  role: z.enum(['viewer', 'analyst', 'admin']).nullable(),
});
export type SetProjectAccessDto = z.infer<typeof setProjectAccessSchema>;
