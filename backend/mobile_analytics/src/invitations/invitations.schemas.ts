import { z } from 'zod';
import { roleSchema } from '../authz/role.schema';

export const createInvitationSchema = z.object({ role: roleSchema });
export type CreateInvitationDto = z.infer<typeof createInvitationSchema>;
