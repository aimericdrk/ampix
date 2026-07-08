import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/cn';
import { ApiError } from '../../../lib/api/problem';
import type {
  CohortBehaviorCondition,
  CohortCondition,
  CohortConditionType,
  CohortCountOp,
  CohortDefinition,
  CohortMatch,
  CohortPreviewResponse,
  CohortPropertyCondition,
  InsightsFilter,
  InsightsFilterOp,
} from '../../../lib/api/types';
import {
  COHORT_CONDITION_TYPES,
  COHORT_COUNT_OPS,
  COHORT_MATCHES,
  INSIGHTS_FILTER_OPS,
} from '../../../lib/api/types';
import {
  useCohort,
  useCohorts,
  useCreateCohort,
  useDeleteCohort,
  useMetaEvents,
  useMetaProperties,
  usePreviewCohortDefinition,
  useUpdateCohort,
} from '../api';
import { PageShell } from '../../../components/layout/PageShell';
import { FavoriteButton } from '../../favorites/FavoriteButton';
import { useFavorites } from '../../favorites/favorites';
import { cleanFilters, FilterRows, VALUELESS_OPS } from './builder-controls';
import { EventSelectField, useAutoRun } from './explore-controls';

const MATCH_LABELS: Record<CohortMatch, string> = {
  all: 'Match all conditions (AND)',
  any: 'Match any condition (OR)',
};

const TYPE_LABELS: Record<CohortConditionType, string> = {
  behavior: 'Did an event',
  did_not: 'Did not do an event',
  property: 'Has a property',
};

const COUNT_OP_LABELS: Record<CohortCountOp, string> = {
  gte: 'at least',
  gt: 'more than',
  lte: 'at most',
  lt: 'fewer than',
  eq: 'exactly',
};

const FILTER_OP_LABELS: Record<InsightsFilterOp, string> = {
  eq: 'equals',
  neq: 'does not equal',
  contains: 'contains',
  gt: 'greater than',
  lt: 'less than',
  is_set: 'is set',
  is_not_set: 'is not set',
};

const MAX_CONDITIONS = 10;

/** The quick builder's "in the last N days" segmented presets — no raw typing. */
const WITHIN_DAYS_PRESETS = [7, 30, 90];
/** Predefined windows offered by the advanced within-days picker (replaces the raw number input). */
const WITHIN_DAYS_OPTIONS = [1, 7, 14, 30, 60, 90];
/** Common event counts offered by the advanced behavior picker (replaces the raw number input). */
const COUNT_OPTIONS = [1, 2, 3, 5, 10];

/** A fresh "did event ≥1 in the last 30 days" behavior — the quick builder's starting point. */
function defaultBehavior(): CohortBehaviorCondition {
  return { type: 'behavior', event: '', op: 'gte', count: 1, within_days: 30, filters: [] };
}

function defaultCondition(type: CohortConditionType, firstProperty: string): CohortCondition {
  if (type === 'behavior') return defaultBehavior();
  if (type === 'did_not') return { type: 'did_not', event: '', within_days: 7 };
  return { type: 'property', property: firstProperty, op: 'eq', value: '' };
}

function normalizeCondition(condition: CohortCondition): CohortCondition {
  if (condition.type === 'behavior') {
    return { ...condition, filters: cleanFilters(condition.filters) };
  }
  if (condition.type === 'property' && VALUELESS_OPS.has(condition.op)) {
    return { type: 'property', property: condition.property, op: condition.op };
  }
  return condition;
}

function conditionIsComplete(condition: CohortCondition): boolean {
  if (condition.type === 'property') return Boolean(condition.property);
  return Boolean(condition.event.trim());
}

/** A single cohort whose primary condition is a plain behavior needs no advanced disclosure. */
function definitionIsSimple(definition: CohortDefinition): boolean {
  return definition.conditions.length === 1 && definition.conditions[0]?.type === 'behavior';
}

export function CohortsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/cohorts' });
  const cohorts = useCohorts(projectId);
  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const createCohort = useCreateCohort(projectId);
  const [currentCohortId, setCurrentCohortId] = useState<string | null>(null);
  const updateCohort = useUpdateCohort(projectId, currentCohortId ?? '');
  const deleteCohort = useDeleteCohort(projectId);
  const previewCohort = usePreviewCohortDefinition(projectId);
  const favorites = useFavorites(projectId);

  const eventOptions = metaEvents.data?.events ?? [];
  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];
  const firstProperty = propertyNames[0] ?? '';

  const [name, setName] = useState('');
  const [match, setMatch] = useState<CohortMatch>('all');
  const [conditions, setConditions] = useState<CohortCondition[]>([defaultBehavior()]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewResult, setPreviewResult] = useState<CohortPreviewResponse | null>(null);

  // Edit loads the full definition (the list omits it) via GET /cohorts/:id, then hydrates the builder.
  const [editId, setEditId] = useState<string | null>(null);
  const cohortDetail = useCohort(projectId, editId ?? '');

  const definition: CohortDefinition = useMemo(
    () => ({ match, conditions: conditions.map(normalizeCondition) }),
    [match, conditions],
  );

  const primary = conditions[0];

  useEffect(() => {
    const detail = cohortDetail.data;
    if (!editId || !detail || detail.id !== editId) return;
    setCurrentCohortId(detail.id);
    setName(detail.name);
    setMatch(detail.definition.match);
    setConditions(detail.definition.conditions);
    setShowAdvanced(!definitionIsSimple(detail.definition));
    setPreviewResult(null);
    setEditId(null); // consume so the effect doesn't re-hydrate over the analyst's edits
  }, [editId, cohortDetail.data]);

  // Live preview: POST the current definition (no save) whenever it changes and is runnable.
  const runnable = conditions.length > 0 && conditions.every(conditionIsComplete);
  useAutoRun({
    key: JSON.stringify(definition),
    enabled: runnable,
    run: () => previewCohort.mutate(definition, { onSuccess: setPreviewResult }),
  });

  const canSave =
    name.trim().length > 0 &&
    runnable &&
    !createCohort.isPending &&
    !updateCohort.isPending;

  const resetBuilder = () => {
    setName('');
    setMatch('all');
    setConditions([defaultBehavior()]);
    setCurrentCohortId(null);
    setEditId(null);
    setShowAdvanced(false);
    setPreviewResult(null);
  };

  const addCondition = () => {
    if (conditions.length >= MAX_CONDITIONS) return;
    setConditions((current) => [...current, defaultCondition('behavior', firstProperty)]);
  };

  const setConditionAt = (index: number, next: CohortCondition) => {
    setConditions((current) => current.map((c, i) => (i === index ? next : c)));
  };

  const changeConditionType = (index: number, type: CohortConditionType) => {
    setConditionAt(index, defaultCondition(type, firstProperty));
  };

  const removeCondition = (index: number) => {
    setConditions((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
  };

  const handleSave = () => {
    if (!canSave) return;
    if (currentCohortId) {
      updateCohort.mutate({ name: name.trim(), definition });
      return;
    }
    createCohort.mutate(
      { name: name.trim(), definition },
      { onSuccess: (cohort) => setCurrentCohortId(cohort.id) },
    );
  };

  const saveError =
    (createCohort.error ?? updateCohort.error) instanceof ApiError
      ? ((createCohort.error ?? updateCohort.error) as ApiError).problem.title
      : null;

  return (
    <PageShell
      projectId={projectId}
      title="Cohorts"
      description="Build an audience — pick an event, watch the size update live, then save."
      breadcrumbs={[{ label: 'Audience' }, { label: 'Cohorts' }]}
      actions={
        <Button type="button" variant="secondary" onClick={resetBuilder}>
          New cohort
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Saved cohorts</CardTitle>
        </CardHeader>
        <CardContent>
          {cohorts.isPending && <p role="status">Loading cohorts…</p>}
          {cohorts.error && (
            <p role="alert" className="text-danger">
              {cohorts.error instanceof ApiError ? cohorts.error.problem.title : 'Failed to load cohorts'}
            </p>
          )}
          {cohorts.data && cohorts.data.cohorts.length === 0 && (
            <p className="text-text-muted">No cohorts yet.</p>
          )}
          {cohorts.data && cohorts.data.cohorts.length > 0 && (
            <ul className="flex flex-col gap-2">
              {cohorts.data.cohorts.map((cohort) => (
                <li
                  key={cohort.id}
                  className="flex items-center gap-2 rounded-md border border-border p-2"
                >
                  <span className="flex-1 text-sm font-medium">{cohort.name}</span>
                  <FavoriteButton
                    name={cohort.name}
                    isFavorite={favorites.isFavorite('cohort', cohort.id)}
                    onToggle={() =>
                      favorites.toggle({ type: 'cohort', id: cohort.id, name: cohort.name })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ${cohort.name}`}
                    onClick={() => setEditId(cohort.id)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete ${cohort.name}`}
                    onClick={() =>
                      deleteCohort.mutate(cohort.id, {
                        onSuccess: () => {
                          if (currentCohortId === cohort.id) resetBuilder();
                        },
                      })
                    }
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{currentCohortId ? 'Edit cohort' : 'New cohort'}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div>
            <label htmlFor="cohort-name" className="mb-1 block text-sm font-medium">
              Cohort name
            </label>
            <Input
              id="cohort-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Recent buyers"
            />
          </div>

          {/* Quick builder: "who did <event> in the last N days" — no raw typing. */}
          {primary?.type === 'behavior' ? (
            <div className="flex flex-wrap items-end gap-6">
              <EventSelectField
                label="Event"
                value={primary.event}
                onChange={(value) => setConditionAt(0, { ...primary, event: value })}
                options={eventOptions}
                isLoading={metaEvents.isPending}
                noun="event"
                placeholder="Select an event…"
                emptyLabel="No events tracked yet."
              />
              <WithinDaysPresets
                value={primary.within_days}
                onChange={(within_days) => setConditionAt(0, { ...primary, within_days })}
              />
            </div>
          ) : (
            <p className="text-sm text-text-muted">
              Your first condition is configured in the advanced section below.
            </p>
          )}

          {/* Live preview: updates on its own as the definition changes, before any save. */}
          <div className="rounded-md border border-border p-4" aria-live="polite">
            {!runnable && (
              <p className="text-sm text-text-muted">
                Pick an event to preview how many users match.
              </p>
            )}
            {runnable && previewCohort.isError && (
              <p role="alert" className="text-danger">
                {previewCohort.error instanceof ApiError
                  ? previewCohort.error.problem.title
                  : 'Failed to preview the cohort'}
              </p>
            )}
            {runnable && previewCohort.isPending && !previewResult && <p role="status">Computing…</p>}
            {runnable && previewResult && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-text-muted">Cohort size</p>
                  {previewCohort.isPending && (
                    <span role="status" className="text-xs text-text-muted">
                      Computing…
                    </span>
                  )}
                </div>
                <p className="text-3xl font-semibold tabular-nums">{previewResult.count}</p>
                {previewResult.sample.length > 0 && (
                  <p className="text-xs text-text-muted">Sample: {previewResult.sample.join(', ')}</p>
                )}
              </div>
            )}
          </div>

          {saveError && (
            <p role="alert" className="text-danger">
              {saveError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={!canSave}>
              {createCohort.isPending || updateCohort.isPending
                ? 'Saving…'
                : currentCohortId
                  ? 'Save changes'
                  : 'Save cohort'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((value) => !value)}
              className="border border-dashed border-border font-normal text-text-muted hover:text-text"
            >
              <span aria-hidden="true">+</span>{' '}
              {showAdvanced ? 'Hide advanced' : 'Add conditions & filters'}
            </Button>
          </div>

          {showAdvanced && (
            <div className="flex flex-col gap-4 border-t border-border pt-5">
              <div>
                <label htmlFor="cohort-match" className="mb-1 block text-sm font-medium">
                  Match
                </label>
                <select
                  id="cohort-match"
                  value={match}
                  onChange={(e) => setMatch(e.target.value as CohortMatch)}
                  className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
                >
                  {COHORT_MATCHES.map((value) => (
                    <option key={value} value={value}>
                      {MATCH_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Conditions ({conditions.length}/{MAX_CONDITIONS})
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={addCondition}
                  disabled={conditions.length >= MAX_CONDITIONS}
                >
                  Add condition
                </Button>
              </div>
              {conditions.map((condition, index) => (
                <ConditionRow
                  key={index}
                  index={index}
                  condition={condition}
                  eventOptions={eventOptions}
                  eventsLoading={metaEvents.isPending}
                  propertyNames={propertyNames}
                  projectId={projectId}
                  canRemove={conditions.length > 1}
                  onType={(type) => changeConditionType(index, type)}
                  onChange={(next) => setConditionAt(index, next)}
                  onRemove={() => removeCondition(index)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

/** A segmented "7 · 30 · 90 days" control (mirrors DateRangePresets) — the quick within-days picker. */
function WithinDaysPresets({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">In the last</span>
      <div
        role="radiogroup"
        aria-label="In the last"
        className="inline-flex w-fit flex-wrap gap-0.5 rounded-lg border border-border bg-surface p-0.5"
      >
        {WITHIN_DAYS_PRESETS.map((days) => {
          const active = value === days;
          return (
            <button
              key={days}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(days)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                active
                  ? 'bg-accent font-medium text-accent-fg'
                  : 'text-text-muted hover:bg-border/40 hover:text-text',
              )}
            >
              {days} days
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConditionRow({
  index,
  condition,
  eventOptions,
  eventsLoading,
  propertyNames,
  projectId,
  canRemove,
  onType,
  onChange,
  onRemove,
}: {
  index: number;
  condition: CohortCondition;
  eventOptions: string[];
  eventsLoading: boolean;
  propertyNames: string[];
  projectId: string;
  canRemove: boolean;
  onType: (type: CohortConditionType) => void;
  onChange: (next: CohortCondition) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`condition-${index}-type`}>
          Condition {n} type
        </label>
        <select
          id={`condition-${index}-type`}
          value={condition.type}
          onChange={(e) => onType(e.target.value as CohortConditionType)}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
        >
          {COHORT_CONDITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove condition ${n}`}
            onClick={onRemove}
          >
            Remove
          </Button>
        )}
      </div>

      {condition.type === 'behavior' && (
        <BehaviorFields
          index={index}
          condition={condition}
          eventOptions={eventOptions}
          eventsLoading={eventsLoading}
          propertyNames={propertyNames}
          projectId={projectId}
          onChange={onChange}
        />
      )}

      {condition.type === 'did_not' && (
        <div className="flex flex-wrap items-end gap-3">
          <EventSelectField
            label={`Condition ${n} event`}
            value={condition.event}
            onChange={(value) => onChange({ ...condition, event: value })}
            options={eventOptions}
            isLoading={eventsLoading}
            noun="event"
            placeholder="Select an event…"
          />
          <WithinDaysField
            index={index}
            value={condition.within_days}
            onChange={(within_days) => onChange({ ...condition, within_days })}
          />
        </div>
      )}

      {condition.type === 'property' && (
        <PropertyFields
          index={index}
          condition={condition}
          propertyNames={propertyNames}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function BehaviorFields({
  index,
  condition,
  eventOptions,
  eventsLoading,
  propertyNames,
  projectId,
  onChange,
}: {
  index: number;
  condition: CohortBehaviorCondition;
  eventOptions: string[];
  eventsLoading: boolean;
  propertyNames: string[];
  projectId: string;
  onChange: (next: CohortBehaviorCondition) => void;
}) {
  const n = index + 1;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <EventSelectField
          label={`Condition ${n} event`}
          value={condition.event}
          onChange={(value) => onChange({ ...condition, event: value })}
          options={eventOptions}
          isLoading={eventsLoading}
          noun="event"
          placeholder="Select an event…"
        />
        <div>
          <label htmlFor={`condition-${index}-count-op`} className="mb-1 block text-sm font-medium">
            Count
          </label>
          <select
            id={`condition-${index}-count-op`}
            aria-label={`Condition ${n} count comparison`}
            value={condition.op}
            onChange={(e) => onChange({ ...condition, op: e.target.value as CohortCountOp })}
            className="h-10 rounded-md border border-border bg-surface px-2 text-sm"
          >
            {COHORT_COUNT_OPS.map((op) => (
              <option key={op} value={op}>
                {COUNT_OP_LABELS[op]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="sr-only" htmlFor={`condition-${index}-count`}>
            Condition {n} count
          </label>
          <select
            id={`condition-${index}-count`}
            value={condition.count}
            onChange={(e) => onChange({ ...condition, count: Number(e.target.value) })}
            className="h-10 rounded-md border border-border bg-surface px-2 text-sm"
          >
            {COUNT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <span className="ml-1 text-sm text-text-muted">times</span>
        </div>
        <WithinDaysField
          index={index}
          value={condition.within_days}
          onChange={(within_days) => onChange({ ...condition, within_days })}
        />
      </div>
      <FilterRows
        idPrefix={`condition-${index}-filter`}
        ariaLabel={`Condition ${n} filter`}
        filters={condition.filters}
        onChange={(filters: InsightsFilter[]) => onChange({ ...condition, filters })}
        propertyNames={propertyNames}
        projectId={projectId}
        event={condition.event || undefined}
      />
    </div>
  );
}

function PropertyFields({
  index,
  condition,
  propertyNames,
  onChange,
}: {
  index: number;
  condition: CohortPropertyCondition;
  propertyNames: string[];
  onChange: (next: CohortPropertyCondition) => void;
}) {
  const n = index + 1;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`condition-${index}-property`}>
        Condition {n} property
      </label>
      <select
        id={`condition-${index}-property`}
        value={condition.property}
        onChange={(e) => onChange({ ...condition, property: e.target.value })}
        className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
      >
        {propertyNames.map((propertyName) => (
          <option key={propertyName} value={propertyName}>
            {propertyName}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`condition-${index}-operator`}>
        Condition {n} operator
      </label>
      <select
        id={`condition-${index}-operator`}
        value={condition.op}
        onChange={(e) => onChange({ ...condition, op: e.target.value as InsightsFilterOp })}
        className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
      >
        {INSIGHTS_FILTER_OPS.map((op) => (
          <option key={op} value={op}>
            {FILTER_OP_LABELS[op]}
          </option>
        ))}
      </select>
      {!VALUELESS_OPS.has(condition.op) && (
        <>
          <label className="sr-only" htmlFor={`condition-${index}-value`}>
            Condition {n} value
          </label>
          <Input
            id={`condition-${index}-value`}
            className="h-9 w-40"
            value={condition.value ?? ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
          />
        </>
      )}
    </div>
  );
}

/** A predefined within-days window picker (replaces the old raw number input). */
function WithinDaysField({
  index,
  value,
  onChange,
}: {
  index: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const options = WITHIN_DAYS_OPTIONS.includes(value)
    ? WITHIN_DAYS_OPTIONS
    : [...WITHIN_DAYS_OPTIONS, value].sort((a, b) => a - b);
  return (
    <div>
      <label htmlFor={`condition-${index}-within-days`} className="mb-1 block text-sm font-medium">
        Within
      </label>
      <select
        id={`condition-${index}-within-days`}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 rounded-md border border-border bg-surface px-2 text-sm"
      >
        {options.map((days) => (
          <option key={days} value={days}>
            {days} {days === 1 ? 'day' : 'days'}
          </option>
        ))}
      </select>
    </div>
  );
}
