import { useEffect, useRef, useState } from 'react';
import { shiftRange, type CompareUnit } from '../range-compare';
import { DateRangeFields } from './builder-controls';

export type CompareMode = 'off' | CompareUnit | 'custom';

export interface CompareRange {
  from: string;
  to: string;
}

const COMPARE_OPTIONS: Array<{ value: CompareMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'previous', label: 'Previous period' },
  { value: 'week', label: 'Previous week' },
  { value: 'month', label: 'Same period last month' },
  { value: 'year', label: 'Same period last year' },
  { value: 'custom', label: 'Custom…' },
];

/** A valid custom compare range needs both bounds filled in, with `from` on or before `to` (feat-06
 * §4: "Invalid custom range (from>to or blank) -> don't run the compare; show a hint."). */
function isValidCustomRange(from: string, to: string): boolean {
  return from.length > 0 && to.length > 0 && from <= to;
}

/**
 * The Compare control (feat-06 §3): a single select — Off / Previous period / Previous week / Same
 * period last month / Same period last year / Custom… — that resolves to a compare `{from,to}`
 * range (or `null` when off/invalid) and reports it via `onChange`. Presets derive the compare
 * range from the CURRENT range (`from`/`to` props) via `shiftRange`; Custom reveals a
 * `DateRangeFields` pair and only emits once that range is valid.
 */
export function CompareControl({
  from,
  to,
  onChange,
}: {
  /** The current (primary) date range, used to derive preset compare ranges. */
  from: string;
  to: string;
  onChange: (range: CompareRange | null) => void;
}) {
  const [mode, setMode] = useState<CompareMode>('off');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // `onChange` is read from a ref (mirroring `useAutoRun`'s `runRef`) so a changing parent-side
  // closure never re-fires the effect below on its own — only an actual mode/range change should.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (mode === 'off') {
      onChangeRef.current(null);
      return;
    }
    if (mode === 'custom') {
      onChangeRef.current(
        isValidCustomRange(customFrom, customTo) ? { from: customFrom, to: customTo } : null,
      );
      return;
    }
    onChangeRef.current(shiftRange(from, to, mode));
  }, [mode, from, to, customFrom, customTo]);

  const customInvalid = mode === 'custom' && (customFrom || customTo) && !isValidCustomRange(customFrom, customTo);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="compare-mode" className="mb-1 block text-sm font-medium">
          Compare
        </label>
        <select
          id="compare-mode"
          aria-label="Compare"
          value={mode}
          onChange={(e) => setMode(e.target.value as CompareMode)}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
        >
          {COMPARE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {mode === 'custom' && (
        <div className="flex flex-col gap-1">
          <DateRangeFields
            idPrefix="compare-custom"
            from={customFrom}
            to={customTo}
            onFrom={setCustomFrom}
            onTo={setCustomTo}
          />
          {customInvalid && (
            <p className="text-xs text-danger">Pick a valid range (From on or before To).</p>
          )}
        </div>
      )}
    </div>
  );
}
