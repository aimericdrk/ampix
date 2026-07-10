import { X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { useCloseComboboxOnOutsideClick } from '../../../components/ui/combobox';
import type { InsightsFilter, InsightsFilterOp } from '../../../lib/api/types';
import { INSIGHTS_FILTER_OPS } from '../../../lib/api/types';
import { useMetaProperties } from '../api';
import { useGlobalFilters } from '../global-filters';
import { FILTER_OP_LABELS, FilterValueInput, VALUELESS_OPS } from './builder-controls';

/** A short, plain-language rendering of a filter, e.g. "OS is iOS" / "app_version is set". */
function describeFilter(filter: InsightsFilter): string {
  const opLabel = FILTER_OP_LABELS[filter.op];
  return VALUELESS_OPS.has(filter.op)
    ? `${filter.property} ${opLabel}`
    : `${filter.property} ${opLabel} ${filter.value ?? ''}`;
}

/**
 * The app-wide filter bar (feat-02 §3.2), mounted once in `AppLayout` inside the project scope.
 * Shows the active global filters as removable chips, an "＋ Add filter" popover reusing the
 * shared property picker / operator select / `FilterValueInput` value combobox (never rebuilding
 * them), and a "Clear all" action once any filter is set. When empty, it collapses to a single
 * subtle affordance so it never crowds the page above it.
 */
export function GlobalFilterBar({ projectId }: { projectId: string }) {
  const { filters, addFilter, removeFilter, clearAll } = useGlobalFilters();
  const metaProperties = useMetaProperties(projectId);
  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];

  const [open, setOpen] = useState(false);
  const [draftProperty, setDraftProperty] = useState('');
  const [draftOp, setDraftOp] = useState<InsightsFilterOp>('eq');
  const [draftValue, setDraftValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useCloseComboboxOnOutsideClick(containerRef, open, () => setOpen(false));

  const openAdd = () => {
    setDraftProperty(propertyNames[0] ?? '');
    setDraftOp('eq');
    setDraftValue('');
    setOpen(true);
  };

  const canSubmit =
    draftProperty.trim() !== '' &&
    (VALUELESS_OPS.has(draftOp) || draftValue.trim() !== '');

  const submitAdd = () => {
    if (!canSubmit) return;
    const filter: InsightsFilter = VALUELESS_OPS.has(draftOp)
      ? { property: draftProperty, op: draftOp }
      : { property: draftProperty, op: draftOp, value: draftValue.trim() };
    addFilter(filter);
    setOpen(false);
  };

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Global filters"
      className="relative mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2"
    >
      {filters.length === 0 && !open && (
        <button
          type="button"
          onClick={openAdd}
          className="rounded-full border border-dashed border-border-strong px-3 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
        >
          <span aria-hidden="true">＋</span> Add a filter to scope the whole workspace
        </button>
      )}

      {filters.map((filter, index) => {
        const label = describeFilter(filter);
        return (
          <span
            key={`${filter.property}-${filter.op}-${filter.value ?? ''}-${index}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent"
          >
            {label}
            <button
              type="button"
              aria-label={`Remove filter ${label}`}
              onClick={() => removeFilter(index)}
              className="text-accent/70 hover:text-accent"
            >
              <X aria-hidden="true" size={12} />
            </button>
          </span>
        );
      })}

      {filters.length > 0 && (
        <button
          type="button"
          onClick={openAdd}
          className="rounded-full border border-dashed border-border-strong px-3 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
        >
          <span aria-hidden="true">＋</span> Add filter
        </button>
      )}

      {filters.length > 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
          Clear all
        </Button>
      )}

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Add global filter"
          className="absolute left-3 top-full z-30 mt-1 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3 shadow-lg"
        >
          <div>
            <label className="sr-only" htmlFor="global-filter-property">
              Filter property
            </label>
            <select
              id="global-filter-property"
              value={draftProperty}
              onChange={(e) => setDraftProperty(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
            >
              {propertyNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="sr-only" htmlFor="global-filter-op">
              Filter operator
            </label>
            <select
              id="global-filter-op"
              value={draftOp}
              onChange={(e) => setDraftOp(e.target.value as InsightsFilterOp)}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
            >
              {INSIGHTS_FILTER_OPS.map((op) => (
                <option key={op} value={op}>
                  {FILTER_OP_LABELS[op]}
                </option>
              ))}
            </select>
          </div>
          {!VALUELESS_OPS.has(draftOp) && (
            <FilterValueInput
              id="global-filter-value"
              ariaLabel="Filter value"
              projectId={projectId}
              property={draftProperty}
              value={draftValue}
              onChange={setDraftValue}
            />
          )}
          <Button type="button" size="sm" onClick={submitAdd} disabled={!canSubmit}>
            Add
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
