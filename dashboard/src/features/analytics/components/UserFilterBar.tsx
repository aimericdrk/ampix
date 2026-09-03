import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import { Input, fieldLook } from '../../../components/ui/input';
import { cn } from '../../../lib/cn';
import type { InsightsFilterOp, UserFilter, UserIdentityFilter } from '../../../lib/api/types';
import { useUserProperties, useUserPropertyValues } from '../api';

/** At most as many rows as the API accepts, so the bar can never build a request the server 400s. */
const MAX_FILTERS = 10;

/** The operators, in the words an operator narrowing an audience would use. */
const OP_LABELS: ReadonlyArray<readonly [InsightsFilterOp, string]> = [
  ['eq', 'is'],
  ['neq', 'is not'],
  ['contains', 'contains'],
  ['gt', 'greater than'],
  ['lt', 'less than'],
  ['is_set', 'is set'],
  ['is_not_set', 'is not set'],
];

/** `is set` / `is not set` ask about presence — there is nothing to compare against. */
function needsValue(op: InsightsFilterOp): boolean {
  return op !== 'is_set' && op !== 'is_not_set';
}

/**
 * A row only reaches the API once it says something complete. A half-built row (a property picked,
 * the value not typed yet) is kept on screen but left out of the request — otherwise every
 * "add filter" click would empty the list until the value was finished.
 */
function isComplete(filter: UserFilter): boolean {
  if (filter.property === '') return false;
  return !needsValue(filter.op) || (filter.value ?? '').trim() !== '';
}

/**
 * The audience filter bar: who the Users list shows.
 *
 * Two different questions sit side by side. `identity` splits the people you can CONTACT — their
 * profile carries an email or a phone number — from the ids you cannot. Other profile properties
 * do not count: an age and a city still leave you holding an id, which is the row an operator
 * filtering for "anonymous" is looking for (a backend-written user id with no `people.set` behind
 * it is anonymous here, however real the person is). The filter rows then narrow by any profile
 * property the project actually has: age, gender, city, plan — the list comes from the data, so it
 * is whatever the app has set rather than a hardcoded guess.
 */
export function UserFilterBar({
  projectId,
  identity,
  onIdentityChange,
  onFiltersChange,
}: {
  projectId: string;
  identity: UserIdentityFilter;
  onIdentityChange: (identity: UserIdentityFilter) => void;
  /** Fired with the COMPLETE rows only — see {@link isComplete}. */
  onFiltersChange: (filters: UserFilter[]) => void;
}) {
  const properties = useUserProperties(projectId);
  const [rows, setRows] = useState<UserFilter[]>([]);
  const available = properties.data?.properties ?? [];

  const commit = (next: UserFilter[]) => {
    setRows(next);
    onFiltersChange(next.filter(isComplete));
  };

  const addRow = () =>
    setRows((current) =>
      current.length >= MAX_FILTERS
        ? current
        : [...current, { property: available[0]?.property ?? '', op: 'eq', value: '' }],
    );

  const updateRow = (index: number, patch: Partial<UserFilter>) =>
    commit(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const removeRow = (index: number) => commit(rows.filter((_, i) => i !== index));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="users-identity" className="mb-1.5 block text-sm font-medium">
            Show
          </label>
          <select
            id="users-identity"
            value={identity}
            onChange={(e) => onIdentityChange(e.target.value as UserIdentityFilter)}
            className={cn(fieldLook, 'h-11 w-auto')}
          >
            <option value="all">Everyone</option>
            <option value="identified">Identified — has an email or phone</option>
            <option value="anonymous">Anonymous — no email or phone</option>
          </select>
        </div>

        <Button
          type="button"
          variant="secondary"
          className="h-11 gap-1.5"
          disabled={rows.length >= MAX_FILTERS || available.length === 0}
          onClick={addRow}
        >
          <Plus className="size-4" aria-hidden />
          Add filter
        </Button>

        {properties.isSuccess && available.length === 0 && (
          <p className="text-sm text-text-muted">
            No profile properties yet — call <code>people.set</code> from your app or backend to
            filter on age, gender, plan…
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <ul aria-label="Audience filters" className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Filter ${index + 1} property`}
                value={row.property}
                onChange={(e) => updateRow(index, { property: e.target.value })}
                className={cn(fieldLook, 'w-auto')}
              >
                {/* A property held by nobody any more would otherwise silently reset the row. */}
                {!available.some((p) => p.property === row.property) && row.property !== '' && (
                  <option value={row.property}>{row.property}</option>
                )}
                {available.map((property) => (
                  <option key={property.property} value={property.property}>
                    {property.property}
                  </option>
                ))}
              </select>

              <select
                aria-label={`Filter ${index + 1} operator`}
                value={row.op}
                onChange={(e) => updateRow(index, { op: e.target.value as InsightsFilterOp })}
                className={cn(fieldLook, 'w-auto')}
              >
                {OP_LABELS.map(([op, label]) => (
                  <option key={op} value={op}>
                    {label}
                  </option>
                ))}
              </select>

              {needsValue(row.op) && (
                <FilterValueInput
                  projectId={projectId}
                  index={index}
                  property={row.property}
                  value={row.value ?? ''}
                  onCommit={(value) => updateRow(index, { value })}
                />
              )}

              <IconButton
                aria-label={`Remove filter ${index + 1}`}
                size="sm"
                className="hover:bg-danger-soft hover:text-danger"
                onClick={() => removeRow(index)}
              >
                <X aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The value box. It suggests the values the property actually takes (`gender` is `female`/`male`
 * in one project and something else in the next), and commits on blur or Enter rather than on
 * every keystroke — a refetch per character would page the whole list on the way to a word.
 */
function FilterValueInput({
  projectId,
  index,
  property,
  value,
  onCommit,
}: {
  projectId: string;
  index: number;
  property: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const values = useUserPropertyValues(projectId, property);
  const listId = `user-filter-values-${index}`;

  return (
    <>
      <Input
        aria-label={`Filter ${index + 1} value`}
        list={listId}
        value={draft}
        placeholder="value"
        className="w-40"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          onCommit(draft);
        }}
      />
      <datalist id={listId}>
        {(values.data?.values ?? []).map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
}
