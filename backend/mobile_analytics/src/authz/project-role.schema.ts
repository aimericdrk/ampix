import { z } from 'zod';
export const projectRoleSchema = z.enum(['owner', 'admin', 'analyst', 'viewer']);
