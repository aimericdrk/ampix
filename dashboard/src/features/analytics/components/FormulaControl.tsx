import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { fieldLook } from '../../../components/ui/input';
import { cn } from '../../../lib/cn';
import type { InsightsAggregation, InsightsEventQuery } from '../../../lib/api/types';
import type { FormulaOperator } from '../formula';
import { EventPicker } from './explore-controls';

/** feat-05 §3: plain-language operator labels, in reading order (÷ first — the primary use case). */
export const FORMULA_OPERATOR_OPTIONS: { value: FormulaOperator; label: string }[] = [
  { value: 'ratio', label: '÷ Ratio' },
  { value: 'difference', label: '− Difference' },
  { value: 'sum', label: '+ Sum' },
];

/** The legend/label symbol per operator — e.g. "checkout_completed ÷ app_opened" (feat-05 §3). */
export const FORMULA_OPERATOR_SYMBOLS: Record<FormulaOperator, string> = {
  ratio: '÷',
  difference: '−',
  sum: '+',
};

const MEASURE_LABELS: Record<InsightsAggregation, string> = {
  total: 'Count',
  unique_users: 'Unique users',
};

/** One metric's event + aggregation pair, reusing the searchable {@link EventPicker}. */
function FormulaMetricField({
  label,
  metric,
  options,
  isLoading,
  onChange,
}: {
  label: string;
  metric: InsightsEventQuery;
  options: string[];
  isLoading: boolean;
  onChange: (next: InsightsEventQuery) => void;
}) {
  const measureId = `formula-measure-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <EventPicker
          options={options}
          onSelect={(name) => onChange({ ...metric, name })}
          isLoading={isLoading}
          comboLabel={`Search events for ${label}`}
          triggerAriaLabel={label}
          triggerClassName="w-48 justify-between font-normal"
          triggerLabel={
            metric.name ? (
              <span className="truncate">{metric.name}</span>
            ) : (
              <span className="truncate text-text-muted">Select event…</span>
            )
          }
          emptyLabel="No events tracked yet."
        />
        <label className="sr-only" htmlFor={measureId}>
          Measure for {label}
        </label>
        <select
          id={measureId}
          aria-label={`Measure for ${label}`}
          value={metric.aggregation}
          onChange={(e) => onChange({ ...metric, aggregation: e.target.value as InsightsAggregation })}
          className={cn(fieldLook, 'h-9 w-auto')}
        >
          <option value="total">{MEASURE_LABELS.total}</option>
          <option value="unique_users">{MEASURE_LABELS.unique_users}</option>
        </select>
      </div>
    </div>
  );
}

/**
 * The Formula builder (feat-05 §3): metric A (event + aggregation), an operator (÷ ratio /
 * − difference / + sum), metric B, and an "as %" toggle that only makes sense for a ratio. Purely a
 * controlled input group — `InsightsPage` owns all the state and decides what query to run from it.
 */
export function FormulaControl({
  eventOptions,
  isLoadingEvents,
  metricA,
  metricB,
  operator,
  asPercent,
  onMetricAChange,
  onMetricBChange,
  onOperatorChange,
  onAsPercentChange,
  onRemove,
}: {
  eventOptions: string[];
  isLoadingEvents: boolean;
  metricA: InsightsEventQuery;
  metricB: InsightsEventQuery;
  operator: FormulaOperator;
  asPercent: boolean;
  onMetricAChange: (metric: InsightsEventQuery) => void;
  onMetricBChange: (metric: InsightsEventQuery) => void;
  onOperatorChange: (op: FormulaOperator) => void;
  onAsPercentChange: (value: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Formula</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Remove formula"
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <FormulaMetricField
          label="Metric A"
          metric={metricA}
          options={eventOptions}
          isLoading={isLoadingEvents}
          onChange={onMetricAChange}
        />

        <div>
          <label htmlFor="formula-operator" className="mb-1 block text-sm font-medium">
            Operator
          </label>
          <select
            id="formula-operator"
            aria-label="Operator"
            value={operator}
            onChange={(e) => onOperatorChange(e.target.value as FormulaOperator)}
            className={cn(fieldLook, 'h-9 w-auto')}
          >
            {FORMULA_OPERATOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <FormulaMetricField
          label="Metric B"
          metric={metricB}
          options={eventOptions}
          isLoading={isLoadingEvents}
          onChange={onMetricBChange}
        />

        {operator === 'ratio' && (
          <label className="mb-1.5 flex items-center gap-2 text-sm">
            <Checkbox
              checked={asPercent}
              onCheckedChange={(checked) => onAsPercentChange(checked === true)}
            />
            As %
          </label>
        )}
      </div>
    </div>
  );
}
