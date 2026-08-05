/**
 * Re-export only: the implementation moved to `../shared/to-subscription-state` (M3b) once
 * `GoogleIngestService` needed the exact same projection — kept here so `apple-ingest.service.ts`'s
 * and `to-subscription-state.spec.ts`'s existing `./to-subscription-state` import paths don't need
 * to change. See the shared module for the full docstring.
 */
export { toSubscriptionState } from '../shared/to-subscription-state';
