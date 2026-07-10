import { SetMetadata } from '@nestjs/common';
import type { ProjectRole } from '@prisma/client';
export const PROJECT_ROLES_KEY = 'requiredProjectRole';
export const ProjectRoles = (role: ProjectRole) => SetMetadata(PROJECT_ROLES_KEY, role);
