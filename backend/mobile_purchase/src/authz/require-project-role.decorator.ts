import { SetMetadata } from '@nestjs/common';
import type { ProjectRole } from './project-access.service';

export const REQUIRE_PROJECT_ROLE_KEY = 'requiredProjectRole';

/** Marks a route as requiring at least `role` on the project — enforced by ProjectAccessGuard. */
export const RequireProjectRole = (role: ProjectRole) => SetMetadata(REQUIRE_PROJECT_ROLE_KEY, role);
