import { X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { useCloseComboboxOnOutsideClick } from '../../../components/ui/combobox';
import { fieldLook } from '../../../components/ui/input';
import { cn } from '../../../lib/cn';
import type { InsightsFilter, InsightsFilterOp } from '../../../lib/api/types';
import { INSIGHTS_FILTER_OPS } from '../../../lib/api/types';
import { useRcEnabled } from '../../revenuecat/api';
import { useMetaProperties } from '../api';
import { useGlobalFilters } from '../global-filters';
import { FILTER_OP_LABELS, FilterValueInput, VALUELESS_OPS } from './builder-controls';

/** The RevenueCat profile property the subscription quick filters pivot on. */
const RC_STATUS_PROPERTY = '$rc_status';

/**
 * Curated RevenueCat profile properties appended to the Add-filter property list when RC is
 * connected — profile-scoped, so they never appear for the plain §14 analytics engine.
 */
const RC_CURATED_PROPERTIES = [
  RC_STATUS_PROPERTY,
  '$rc_product_id',
  '$rc_store',
  '$rc_total_spent',
];

/** One-click `$rc_status` presets over the profile store (Subscribers / Trial / Churned). */
const RC_QUICK_FILTERS: Array<{ label: string; value: string }> = [
  { label: 'Subscribers', value: 'active' },
  { label: 'Trial', value: 'trial' },
  { label: 'Churned', value: 'churned' },
];

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
  const { filters, addFilter, removeFilter, clearAll, toggleGlobalFilter } = useGlobalFilters();
  const rcEnabled = useRcEnabled(projectId);
  const metaProperties = useMetaProperties(projectId);
  const baseProperties = metaProperties.data?.properties.map((p) => p.name) ?? [];
  const propertyNames = rcEnabled
    ? [...baseProperties, ...RC_CURATED_PROPERTIES.filter((p) => !baseProperties.includes(p))]
    : baseProperties;

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
      {rcEnabled && (
        <div className="flex items-center gap-1.5" role="group" aria-label="Subscription quick filters">
          <span className="text-xs font-medium text-text-muted">Subscription:</span>
          {RC_QUICK_FILTERS.map(({ label, value }) => {
            const active = filters.some(
              (f) => f.property === RC_STATUS_PROPERTY && f.value === value && f.target === 'profile',
            );
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  toggleGlobalFilter({
                    property: RC_STATUS_PROPERTY,
                    op: 'eq',
                    value,
                    target: 'profile',
                  })
                }
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]',
                  active
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border-strong text-text-muted hover:border-accent hover:text-accent',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {filters.length === 0 && !open && (
        <button
          type="button"
          onClick={openAdd}
          className="rounded-full border border-dashed border-border-strong px-3 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]"
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
            {filter.target === 'profile' && (
              <span className="rounded bg-accent/15 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent/80">
                profile
              </span>
            )}
            <button
              type="button"
              aria-label={`Remove filter ${label}`}
              onClick={() => removeFilter(index)}
              className="rounded-full text-accent/70 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
          className="rounded-full border border-dashed border-border-strong px-3 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]"
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
          className="absolute left-3 top-full z-30 mt-1 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-raised p-3 shadow-lift"
        >
          <div>
            <label className="sr-only" htmlFor="global-filter-property">
              Filter property
            </label>
            <select
              id="global-filter-property"
              value={draftProperty}
              onChange={(e) => setDraftProperty(e.target.value)}
              className={cn(fieldLook, 'h-9 w-auto')}
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
              className={cn(fieldLook, 'h-9 w-auto')}
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
