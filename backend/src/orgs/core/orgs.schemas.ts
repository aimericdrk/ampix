import { z } from 'zod';

const MAX_NAME_LENGTH = 200;

export const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});
export type CreateOrgDto = z.infer<typeof createOrgSchema>;

export const renameOrgSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});
export type RenameOrgDto = z.infer<typeof renameOrgSchema>;
