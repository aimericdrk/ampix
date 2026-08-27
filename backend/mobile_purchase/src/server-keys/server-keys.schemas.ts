import { z } from 'zod';

const MAX_LABEL_LENGTH = 200;

/**
 * `can_erase` is the only capability a server key carries today, and it is fixed for the key's
 * lifetime — there is no update route. Rotating means minting a replacement and revoking the old
 * one, which keeps "what is this credential allowed to do" answerable from the row alone.
 */
export const createServerKeySchema = z.object({
  label: z.string().trim().min(1).max(MAX_LABEL_LENGTH).optional(),
  can_erase: z.boolean().optional(),
});
export type CreateServerKeyDto = z.infer<typeof createServerKeySchema>;

/** GET list item. `key` is returned in full: it is retrievable, not a one-time reveal. */
export interface ServerKeyListItem {
  id: string;
  key: string;
  label: string;
  can_erase: boolean;
  created_at: string;
}
