import { fieldLook } from '../../../components/ui/input';
import { cn } from '../../../lib/cn';
import { useCohortPreview, useCohorts } from '../api';
import { formatExactNumber } from '../format';

/**
 * Scopes any Insights/Funnels/Retention query to a saved cohort ("segment"). `value` is the
 * selected cohort id, or `null` for the unfiltered "All users" default — the shape every builder's
 * query definition wants for its optional `cohort_id` (contracts §14/§15).
 *
 * Reuses the plain labelled `<select>` pattern (see `CohortSelect` in `report-actions.tsx`) rather
 * than the typeahead combobox: a project's saved segments are a short, fully-known list, so a
 * native dropdown is the simplest accessible control. Once a segment is chosen, its live size is
 * fetched via `useCohortPreview` and shown underneath so the analyst knows roughly how many users
 * they're scoping down to before running the query.
 */
export function SegmentPicker({
  projectId,
  value,
  onChange,
  id = 'segment-picker',
  label = 'Segment',
}: {
  projectId: string;
  value: string | null;
  onChange: (segmentId: string | null) => void;
  id?: string;
  label?: string;
}) {
  const cohorts = useCohorts(projectId);
  const preview = useCohortPreview(projectId, value);

  const options = cohorts.data?.cohorts ?? [];
  const isLoading = cohorts.isPending;
  const hasNoSegments = cohorts.isSuccess && options.length === 0;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={isLoading}
        className={cn(fieldLook, 'w-auto')}
      >
        <option value="">All users (no segment)</option>
        {options.map((cohort) => (
          <option key={cohort.id} value={cohort.id}>
            {cohort.name}
          </option>
        ))}
      </select>

      {isLoading && <p className="mt-1 text-xs text-text-muted">Loading segments…</p>}
      {!isLoading && hasNoSegments && (
        <p className="mt-1 text-xs text-text-muted">No saved segments yet.</p>
      )}
      {value && preview.isPending && (
        <p className="mt-1 text-xs text-text-muted">Loading segment size…</p>
      )}
      {value && preview.data && (
        <p className="mt-1 text-xs text-text-muted">
          ≈ {formatExactNumber(preview.data.count)} users
        </p>
      )}
    </div>
  );
}
