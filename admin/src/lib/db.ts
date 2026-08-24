import { PrismaClient } from '../../generated/client';

/**
 * PrismaClient singleton. Next.js dev-mode hot reload re-evaluates modules; stashing the client on
 * globalThis prevents connection-pool exhaustion. In production this is a plain singleton.
 */
const globalForPrisma = globalThis as unknown as { adminPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.adminPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.adminPrisma = prisma;
