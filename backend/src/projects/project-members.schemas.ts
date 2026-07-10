import { z } from 'zod';
import { projectRoleSchema } from '../authz/project-role.schema';

export const addProjectMemberSchema = z.object({ userId: z.string().uuid(), role: projectRoleSchema });
export const updateProjectMemberRoleSchema = z.object({ role: projectRoleSchema });
export type AddProjectMemberDto = z.infer<typeof addProjectMemberSchema>;
export type UpdateProjectMemberRoleDto = z.infer<typeof updateProjectMemberRoleSchema>;
