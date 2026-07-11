import { z } from 'zod';
import { orgRoleSchema } from '../authz/role.schema';

export const changeMemberRoleSchema = z.object({ role: orgRoleSchema });
export type ChangeMemberRoleDto = z.infer<typeof changeMemberRoleSchema>;
