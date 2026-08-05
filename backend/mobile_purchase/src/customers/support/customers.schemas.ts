import { z } from 'zod';

/**
 * Dashboard-facing customers LIST query (design §1.3): `search` matches `appUserId`
 * case-insensitive contains; `limit` defaults to 25, capped at 100; `cursor` is the opaque
 * keyset-pagination token from a previous page's `nextCursor`. Query params arrive as strings —
 * `z.coerce.number()` parses `limit`. An empty `search` (a cleared search box) is treated the
 * same as omitted by `CustomersQueryService` (a falsy check), so it is not rejected here.
 */
export const customersListQuerySchema = z.object({
  search: z.string().trim().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().min(1).optional(),
});

export type CustomersListQuery = z.infer<typeof customersListQuerySchema>;
