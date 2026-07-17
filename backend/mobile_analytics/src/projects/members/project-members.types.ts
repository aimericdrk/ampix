import type { ProjectRole } from '@prisma/client';

export interface ProjectMemberListItem {
  user: { id: string; email: string; name: string };
  role: ProjectRole;
}

export interface UpdatedProjectMember {
  user_id: string;
  role: ProjectRole;
}
