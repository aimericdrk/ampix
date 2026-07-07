import { useMemo } from 'react';
import { Button } from '../../../components/ui/button';
import { useCohorts } from '../api';
import { colorForIndex } from '../palette';
import { EventPicker } from './explore-controls';

export const MAX_COMPARE_SEGMENTS = 4;

export const ALL_USERS_SEGMENT_LABEL = 'All users';

/** The chart-legend / summary-row label for a selected segment id (`null` = "All users"). A cohort
 * id that no longer resolves (deleted after being selected) falls back to a visible placeholder
 * rather than disappearing, per feat-04 §4. */
export function segmentLabel(id: string | null, cohortNameById: Map<string, string>): string {
  if (id === null) return ALL_USERS_SEGMENT_LABEL;
  return cohortNameById.get(id) ?? 'Unknown segment';
}

/**
 * Multi-select over "All users" (no cohort) + the project's saved cohorts, capped at
 * {@link MAX_COMPARE_SEGMENTS} — feat-04 §3.1. Each pick renders as a removable chip carrying the
 * same fixed-order color (`colorForIndex`) the chart/summary use for that position, so a segment's
 * color never changes as siblings are added or removed. Selecting a 2nd segment is what turns the
 * page's compare mode on; this component only owns the list of selected ids, not that decision.
 *
 * Reuses {@link EventPicker}'s accessible combobox+listbox over plain labels (like the event picker
 * above it) rather than inventing a second picker pattern — segments are looked up by label, with
 * "All users" always offered first regardless of how many cohorts exist.
 */
export function SegmentCompareControl({
  projectId,
  selected,
  onChange,
  max = MAX_COMPARE_SEGMENTS,
}: {
  projectId: string;
  selected: Array<string | null>;
  onChange: (next: Array<string | null>) => void;
  max?: number;
}) {
  const cohorts = useCohorts(projectId);
  const cohortOptions = cohorts.data?.cohorts ?? [];

  const cohortNameById = useMemo(
    () => new Map(cohortOptions.map((c) => [c.id, c.name])),
    [cohortOptions],
  );

  // Label -> id lookup for the picker. Two cohorts sharing a name is a pre-existing possibility
  // (the plain `SegmentPicker` <select> has the same tradeoff) — first match wins.
  const labelToId = useMemo(() => {
    const map = new Map<string, string | null>();
    map.set(ALL_USERS_SEGMENT_LABEL, null);
    for (const cohort of cohortOptions) {
      if (!map.has(cohort.name)) map.set(cohort.name, cohort.id);
    }
    return map;
  }, [cohortOptions]);

  const allLabels = Array.from(labelToId.keys());
  const selectedLabels = selected.map((id) => segmentLabel(id, cohortNameById));
  const atMax = selected.length >= max;

  const addSegment = (label: string) => {
    if (atMax) return;
    const id = labelToId.get(label);
    if (id === undefined) return;
    if (selected.includes(id)) return;
    onChange([...selected, id]);
  };

  const removeSegment = (index: number) => {
    onChange(selected.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 && (
        <ul aria-label="Segments being compared" className="flex flex-wrap items-center gap-2">
          {selected.map((id, index) => {
            const label = segmentLabel(id, cohortNameById);
            return (
              <li
                key={`${id ?? 'all-users'}-${index}`}
                className="flex items-center gap-1.5 rounded-full border border-border bg-bg/40 py-1 pl-2.5 pr-1 text-sm"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colorForIndex(index) }}
                />
                <span>{label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${label} from comparison`}
                  onClick={() => removeSegment(index)}
                  className="h-6 w-6 rounded-full p-0"
                >
                  ✕
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <EventPicker
          options={allLabels}
          onSelect={addSegment}
          exclude={selectedLabels}
          isLoading={cohorts.isPending}
          disabled={atMax}
          noun="segment"
          comboLabel="Add segment to compare"
          triggerAriaLabel="Add segment to compare"
          triggerLabel="+ Add segment"
          emptyLabel="No saved segments yet."
        />
        {atMax && (
          <p className="mt-1 text-xs text-text-muted">Up to {max} segments can be compared.</p>
        )}
      </div>
    </div>
  );
}
