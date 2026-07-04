import { useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { ApiError } from '../../../lib/api/problem';
import type {
  CohortBehaviorCondition,
  CohortCondition,
  CohortConditionType,
  CohortCountOp,
  CohortDefinition,
  CohortMatch,
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
  useCohortPreview,
  useCohorts,
  useCreateCohort,
  useDeleteCohort,
  useMetaEvents,
  useMetaProperties,
  useUpdateCohort,
} from '../api';
import { ProjectAnalyticsNav } from './ProjectAnalyticsNav';
import { cleanFilters, EventNameInput, FilterRows, VALUELESS_OPS } from './builder-controls';

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

function defaultCondition(type: CohortConditionType, firstProperty: string): CohortCondition {
  if (type === 'behavior') {
    return { type: 'behavior', event: '', op: 'gte', count: 1, within_days: 30, filters: [] };
  }
  if (type === 'did_not') {
    return { type: 'did_not', event: '', within_days: 7 };
  }
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

export function CohortsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/cohorts' });
  const cohorts = useCohorts(projectId);
  const metaEvents = useMetaEvents(projectId);
  const metaProperties = useMetaProperties(projectId);
  const createCohort = useCreateCohort(projectId);
  const [currentCohortId, setCurrentCohortId] = useState<string | null>(null);
  const updateCohort = useUpdateCohort(projectId, currentCohortId ?? '');
  const deleteCohort = useDeleteCohort(projectId);

  const eventOptions = metaEvents.data?.events ?? [];
  const propertyNames = metaProperties.data?.properties.map((p) => p.name) ?? [];
  const firstProperty = propertyNames[0] ?? '';

  const [name, setName] = useState('');
  const [match, setMatch] = useState<CohortMatch>('all');
  const [conditions, setConditions] = useState<CohortCondition[]>([
    { type: 'behavior', event: '', op: 'gte', count: 1, within_days: 30, filters: [] },
  ]);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const preview = useCohortPreview(projectId, previewId);

  const definition: CohortDefinition = useMemo(
    () => ({ match, conditions: conditions.map(normalizeCondition) }),
    [match, conditions],
  );

  const canSave =
    name.trim().length > 0 &&
    conditions.length > 0 &&
    conditions.every(conditionIsComplete) &&
    !createCohort.isPending &&
    !updateCohort.isPending;

  const resetBuilder = () => {
    setName('');
    setMatch('all');
    setConditions([{ type: 'behavior', event: '', op: 'gte', count: 1, within_days: 30, filters: [] }]);
    setCurrentCohortId(null);
    setPreviewId(null);
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
    setConditions((current) => current.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (!canSave) return;
    if (currentCohortId) {
      updateCohort.mutate(
        { name: name.trim(), definition },
        { onSuccess: (cohort) => setPreviewId(cohort.id) },
      );
      return;
    }
    createCohort.mutate(
      { name: name.trim(), definition },
      {
        onSuccess: (cohort) => {
          setCurrentCohortId(cohort.id);
          setPreviewId(cohort.id);
        },
      },
    );
  };

  const loadForEdit = (id: string) => {
    const found = cohorts.data?.cohorts.find((c) => c.id === id);
    if (!found) return;
    setCurrentCohortId(id);
    setPreviewId(null);
    setName(found.name);
    // The list endpoint omits `definition`; fetch-on-edit is out of scope here — start from the
    // current builder state and let the analyst re-express it, then Save (PATCH) to persist.
  };

  const saveError =
    (createCohort.error ?? updateCohort.error) instanceof ApiError
      ? ((createCohort.error ?? updateCohort.error) as ApiError).problem.title
      : null;

  return (
    <section className="flex flex-col gap-6">
      <ProjectAnalyticsNav projectId={projectId} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cohorts</h1>
        <Button type="button" variant="secondary" onClick={resetBuilder}>
          New cohort
        </Button>
      </div>

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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Preview ${cohort.name}`}
                    onClick={() => setPreviewId(cohort.id)}
                  >
                    Preview
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ${cohort.name}`}
                    onClick={() => loadForEdit(cohort.id)}
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
                          if (previewId === cohort.id) setPreviewId(null);
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
          <div className="flex flex-wrap gap-4">
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
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Conditions ({conditions.length}/{MAX_CONDITIONS})</span>
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
                propertyNames={propertyNames}
                onType={(type) => changeConditionType(index, type)}
                onChange={(next) => setConditionAt(index, next)}
                onRemove={() => removeCondition(index)}
              />
            ))}
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
              variant="secondary"
              onClick={() => currentCohortId && setPreviewId(currentCohortId)}
              disabled={!currentCohortId}
              title={currentCohortId ? undefined : 'Save the cohort to preview its size'}
            >
              Preview cohort
            </Button>
            {!currentCohortId && (
              <span className="text-xs text-text-muted">Save the cohort to preview its size.</span>
            )}
          </div>

          {previewId && (
            <div className="rounded-md border border-border p-4" aria-live="polite">
              {preview.isPending && <p role="status">Computing cohort size…</p>}
              {preview.error && (
                <p role="alert" className="text-danger">
                  {preview.error instanceof ApiError
                    ? preview.error.problem.title
                    : 'Failed to preview the cohort'}
                </p>
              )}
              {preview.data && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-text-muted">Cohort size</p>
                  <p className="text-3xl font-semibold tabular-nums">{preview.data.count}</p>
                  {preview.data.sample.length > 0 && (
                    <p className="text-xs text-text-muted">
                      Sample: {preview.data.sample.join(', ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ConditionRow({
  index,
  condition,
  eventOptions,
  propertyNames,
  onType,
  onChange,
  onRemove,
}: {
  index: number;
  condition: CohortCondition;
  eventOptions: string[];
  propertyNames: string[];
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove condition ${n}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>

      {condition.type === 'behavior' && (
        <BehaviorFields
          index={index}
          condition={condition}
          eventOptions={eventOptions}
          propertyNames={propertyNames}
          onChange={onChange}
        />
      )}

      {condition.type === 'did_not' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[12rem]">
            <EventNameInput
              id={`condition-${index}-event`}
              label={`Condition ${n} event`}
              value={condition.event}
              onChange={(value) => onChange({ ...condition, event: value })}
              options={eventOptions}
              placeholder="e.g. app_open"
            />
          </div>
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
  propertyNames,
  onChange,
}: {
  index: number;
  condition: CohortBehaviorCondition;
  eventOptions: string[];
  propertyNames: string[];
  onChange: (next: CohortBehaviorCondition) => void;
}) {
  const n = index + 1;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <EventNameInput
            id={`condition-${index}-event`}
            label={`Condition ${n} event`}
            value={condition.event}
            onChange={(value) => onChange({ ...condition, event: value })}
            options={eventOptions}
            placeholder="e.g. checkout_completed"
          />
        </div>
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
          <input
            id={`condition-${index}-count`}
            type="number"
            min={0}
            value={condition.count}
            onChange={(e) => onChange({ ...condition, count: Number(e.target.value) })}
            className="h-10 w-20 rounded-md border border-border bg-surface px-2 text-sm"
          />
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

function WithinDaysField({
  index,
  value,
  onChange,
}: {
  index: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label htmlFor={`condition-${index}-within-days`} className="mb-1 block text-sm font-medium">
        Within days
      </label>
      <input
        id={`condition-${index}-within-days`}
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 w-24 rounded-md border border-border bg-surface px-2 text-sm"
      />
    </div>
  );
}
