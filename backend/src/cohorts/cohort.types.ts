import type { CohortDefinition } from './cohort.schema';

/** GET /cohorts list item (contracts §16). */
export interface CohortListItem {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** GET /cohorts/:id — the list item plus its definition. */
export interface CohortDetail extends CohortListItem {
  definition: CohortDefinition;
}

/** GET /cohorts/:id/preview (contracts §16): the cohort size + a bounded id sample. */
export interface CohortPreview {
  count: number;
  sample: string[];
}
