import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import type { InsightsFilter, InsightsFilterOp } from '../../../lib/api/types';
import { INSIGHTS_FILTER_OPS } from '../../../lib/api/types';
import { useMetaPropertyValues } from '../api';

/** Shared builder primitives for the Phase-4 analysis pages, mirroring the Insights builder UX. */

export function defaultDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export const FILTER_OP_LABELS: Record<InsightsFilterOp, string> = {
  eq: 'equals',
  neq: 'does not equal',
  contains: 'contains',
  gt: 'greater than',
  lt: 'less than',
  is_set: 'is set',
  is_not_set: 'is not set',
};

export const VALUELESS_OPS = new Set<InsightsFilterOp>(['is_set', 'is_not_set']);

/** Drop incomplete rows and strip the ignored `value` from value-less ops, per §14 filter semantics. */
export function cleanFilters(filters: InsightsFilter[]): InsightsFilter[] {
  return filters
    .filter((f) => f.property && (VALUELESS_OPS.has(f.op) || (f.value ?? '').trim() !== ''))
    .map((f) => (VALUELESS_OPS.has(f.op) ? { property: f.property, op: f.op } : f));
}

/** A from/to date-range pair; `idPrefix` keeps labels unique when several appear on a page. */
export function DateRangeFields({
  idPrefix,
  from,
  to,
  onFrom,
  onTo,
}: {
  idPrefix: string;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-4">
      <div>
        <label htmlFor={`${idPrefix}-from`} className="mb-1 block text-sm font-medium">
          From
        </label>
        <Input
          id={`${idPrefix}-from`}
          type="date"
          value={from}
          onChange={(e) => onFrom(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-to`} className="mb-1 block text-sm font-medium">
          To
        </label>
        <Input id={`${idPrefix}-to`} type="date" value={to} onChange={(e) => onTo(e.target.value)} />
      </div>
    </div>
  );
}

/** An event-name text input backed by the shared `/meta/events` autocomplete datalist. */
export function EventNameInput({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const listId = `${id}-options`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {/* label text is always provided by callers; kept above for association + accessible name */}
      <Input
        id={id}
        list={listId}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {options.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}

/**
 * The value cell of a single filter row, backed by the `/meta/property-values` autosuggest datalist.
 * It is its own component so each row's `useMetaPropertyValues` hook call stays at the top level of a
 * component (React hooks rules forbid calling hooks inside the `.map` of `FilterRows`). When no
 * suggestions come back it degrades to a plain free-text input plus a "Type any value" hint.
 */
export function FilterValueInput({
  id,
  ariaLabel,
  projectId,
  property,
  event,
  value,
  onChange,
}: {
  id: string;
  ariaLabel: string;
  projectId?: string;
  property: string;
  event?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  // Suggestions only when we have a project context AND a chosen property; the hook self-gates
  // on an empty property, so passing '' keeps it disabled (no request) for the fallback case.
  const query = useMetaPropertyValues(projectId ?? '', projectId ? property : '', event);
  const values = query.data?.values ?? [];
  const listId = `${id}-options`;
  const showHint = projectId !== undefined && !query.isLoading && values.length === 0;
  return (
    <div className="flex flex-col">
      <label className="sr-only" htmlFor={id}>
        {ariaLabel}
      </label>
      <Input
        id={id}
        className="h-9 w-40"
        list={values.length > 0 ? listId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {values.length > 0 && (
        <datalist id={listId}>
          {values.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      )}
      {showHint && <span className="mt-1 text-xs text-text-muted">Type any value</span>}
    </div>
  );
}

/** An add/remove editor over an `InsightsFilter[]`, matching the Insights filter rows. */
export function FilterRows({
  idPrefix,
  ariaLabel,
  filters,
  onChange,
  propertyNames,
  projectId,
  event,
}: {
  idPrefix: string;
  ariaLabel: string;
  filters: InsightsFilter[];
  onChange: (filters: InsightsFilter[]) => void;
  propertyNames: string[];
  projectId?: string;
  event?: string;
}) {
  const addFilter = () => {
    onChange([...filters, { property: propertyNames[0] ?? '', op: 'eq', value: '' }]);
  };
  const updateFilter = (index: number, patch: Partial<InsightsFilter>) => {
    onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };
  const removeFilter = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{ariaLabel}</span>
        <Button type="button" variant="secondary" size="sm" onClick={addFilter}>
          Add filter
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {filters.map((filter, index) => (
          <li key={index} className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`${idPrefix}-property-${index}`}>
              {ariaLabel} property {index + 1}
            </label>
            <select
              id={`${idPrefix}-property-${index}`}
              value={filter.property}
              onChange={(e) => updateFilter(index, { property: e.target.value })}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
            >
              {propertyNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor={`${idPrefix}-op-${index}`}>
              {ariaLabel} operator {index + 1}
            </label>
            <select
              id={`${idPrefix}-op-${index}`}
              value={filter.op}
              onChange={(e) => updateFilter(index, { op: e.target.value as InsightsFilterOp })}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
            >
              {INSIGHTS_FILTER_OPS.map((op) => (
                <option key={op} value={op}>
                  {FILTER_OP_LABELS[op]}
                </option>
              ))}
            </select>
            {!VALUELESS_OPS.has(filter.op) && (
              <FilterValueInput
                id={`${idPrefix}-value-${index}`}
                ariaLabel={`${ariaLabel} value ${index + 1}`}
                projectId={projectId}
                property={filter.property}
                event={event}
                value={filter.value ?? ''}
                onChange={(v) => updateFilter(index, { value: v })}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove ${ariaLabel} ${index + 1}`}
              onClick={() => removeFilter(index)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
