import { z } from 'zod';
import { roleSchema } from '../authz/role.schema';

export const changeMemberRoleSchema = z.object({ role: roleSchema });
export type ChangeMemberRoleDto = z.infer<typeof changeMemberRoleSchema>;
