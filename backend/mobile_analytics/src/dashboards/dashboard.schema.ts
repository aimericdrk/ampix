import { z } from 'zod';
import { reportKindSchema } from '../reports/report.schema';

/**
 * Dashboard / tile schemas (contracts §16). The grid is a fixed 12-column layout: `w` 1..12, `h` >= 1,
 * `x` 0..11, `y` >= 0, and `x + w <= 12` (validated server-side). A tile references EXACTLY ONE of
 * `saved_report_id` / `inline_definition` (enforced here AND in the service).
 */

export const GRID_COLUMNS = 12;

const MAX_NAME_LENGTH = 200;
const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);

const xSchema = z.number().int('x must be an integer').min(0, 'x must be >= 0').max(GRID_COLUMNS - 1);
const ySchema = z.number().int('y must be an integer').min(0, 'y must be >= 0');
const wSchema = z
  .number()
  .int('w must be an integer')
  .min(1, 'w must be >= 1')
  .max(GRID_COLUMNS, 'w must be <= 12');
const hSchema = z.number().int('h must be an integer').min(1, 'h must be >= 1');
const positionSchema = z.number().int('position must be an integer').min(0, 'position must be >= 0');

/** `x + w <= 12` — the tile must fit within the 12-column grid. */
export function fitsGrid(p: { x: number; w: number }): boolean {
  return p.x + p.w <= GRID_COLUMNS;
}
const gridBoundsMessage = { message: 'x + w must be <= 12 (tile overflows the grid)', path: ['w'] };

export const createDashboardSchema = z.object({ name: nameSchema });
export type CreateDashboardDto = z.infer<typeof createDashboardSchema>;

export const updateDashboardSchema = z.object({ name: nameSchema });
export type UpdateDashboardDto = z.infer<typeof updateDashboardSchema>;

export const createTileSchema = z
  .object({
    title: nameSchema,
    saved_report_id: z.string().uuid().optional(),
    inline_definition: z.unknown().optional(),
    kind: reportKindSchema,
    x: xSchema,
    y: ySchema,
    w: wSchema,
    h: hSchema,
  })
  .refine((t) => (t.saved_report_id != null) !== (t.inline_definition != null), {
    message: 'a tile must reference exactly one of saved_report_id or inline_definition',
    path: ['saved_report_id'],
  })
  .refine(fitsGrid, gridBoundsMessage);
export type CreateTileDto = z.infer<typeof createTileSchema>;

/** PATCH tile: move / resize / retitle. Cross-field `x + w <= 12` is checked in the service against
 *  the merged (existing + patch) placement, since a partial patch may set only one of x/w. */
export const updateTileSchema = z
  .object({
    title: nameSchema.optional(),
    x: xSchema.optional(),
    y: ySchema.optional(),
    w: wSchema.optional(),
    h: hSchema.optional(),
  })
  .refine(
    (t) => t.title !== undefined || t.x !== undefined || t.y !== undefined || t.w !== undefined || t.h !== undefined,
    { message: 'at least one field is required' },
  );
export type UpdateTileDto = z.infer<typeof updateTileSchema>;

export const layoutSchema = z.object({
  tiles: z
    .array(
      z
        .object({
          id: z.string().uuid(),
          x: xSchema,
          y: ySchema,
          w: wSchema,
          h: hSchema,
          position: positionSchema,
        })
        .refine(fitsGrid, gridBoundsMessage),
    )
    .min(1, 'at least one tile is required'),
});
export type LayoutDto = z.infer<typeof layoutSchema>;
