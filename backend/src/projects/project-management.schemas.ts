import { z } from 'zod';

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

export const createTokenSchema = z.object({
  label: z.string().trim().min(1).max(MAX_LABEL_LENGTH).optional(),
});
export type CreateTokenDto = z.infer<typeof createTokenSchema>;
