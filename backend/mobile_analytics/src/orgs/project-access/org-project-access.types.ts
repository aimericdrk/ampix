import type { ProjectRole } from '@prisma/client';

export interface ProjectAccessItem {
  projectId: string;
  name: string;
  role: ProjectRole | null;
}
export interface ListProjectAccessResponse {
  projects: ProjectAccessItem[];
}
