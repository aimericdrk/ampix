import { z } from 'zod';

/** The three §13 Membership roles, in the shape client bodies send them. */
export const roleSchema = z.enum(['admin', 'analyst', 'viewer']);
