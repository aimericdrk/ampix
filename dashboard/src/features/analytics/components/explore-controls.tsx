import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import {
  ComboboxListbox,
  filterOptions,
  useCloseComboboxOnOutsideClick,
} from '../../../components/ui/combobox';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/cn';
import { DateRangeFields, defaultDate } from './builder-controls';

/**
 * Shared, plain-language building blocks for the Explore section (Insights / Funnels / Retention /
 * Flows / Paths). The goal is a calm, guided builder: pick a real event from a searchable list
 * (never type a raw name), choose a date range from presets, and let the result update on its own.
 * These primitives change only how a query is composed — the §14/§15 request bodies are unchanged.
 */

// --- Searchable event picker (combobox) -------------------------------------------------------

/**
 * A click-to-open combobox over the project's REAL events (or screens). Type to filter, click to
 * pick — there is no free-text entry and no separate "Add" button, so a user can only choose things
 * that actually exist. Follows the ARIA combobox+listbox pattern (roving `aria-activedescendant`).
 */
export function EventPicker({
  options,
  onSelect,
  triggerLabel,
  triggerAriaLabel,
  comboLabel,
  noun = 'event',
  exclude = [],
  isLoading = false,
  disabled = false,
  triggerClassName,
  emptyLabel,
}: {
  /** The real, selectable names (events or screens) fetched from metadata. */
  options: string[];
  onSelect: (name: string) => void;
  /** Visible trigger content (e.g. "Add event", or the current selection). */
  triggerLabel: ReactNode;
  /** Stable accessible name for the trigger, so tests/screen-readers can find it regardless of state. */
  triggerAriaLabel?: string;
  /** Accessible name for the search box + listbox. */
  comboLabel: string;
  /** Singular label used in the loading/empty copy ("event" → "Loading events…"). */
  noun?: string;
  /** Names to hide (already chosen), so the same thing can't be picked twice. */
  exclude?: string[];
  isLoading?: boolean;
  disabled?: boolean;
  triggerClassName?: string;
  /** Copy shown when the project has none of this thing yet. */
  emptyLabel?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const available = options.filter((name) => !exclude.includes(name));
  const filtered = filterOptions(available, query);

  useCloseComboboxOnOutsideClick(containerRef, open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const choose = (name: string) => {
    onSelect(name);
    setOpen(false);
  };

  const activeOptionId =
    filtered.length > 0 ? `${listId}-opt-${Math.min(activeIndex, filtered.length - 1)}` : undefined;

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        disabled={disabled}
        className={cn('gap-1.5', triggerClassName)}
        onClick={() => setOpen((value) => !value)}
      >
        {triggerLabel}
        <span aria-hidden="true" className="text-text-muted">
          ▾
        </span>
      </Button>

      {open && (
        <div className="absolute left-0 z-30 mt-1.5 w-64 rounded-lg border border-border bg-surface p-2 shadow-lg">
          <Input
            ref={inputRef}
            role="combobox"
            aria-label={comboLabel}
            aria-controls={listId}
            aria-expanded
            aria-activedescendant={activeOptionId}
            className="h-9"
            placeholder={`Search ${noun}s…`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const pick = filtered[activeIndex];
                if (pick) choose(pick);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
              }
            }}
          />
          <ComboboxListbox
            listId={listId}
            comboLabel={comboLabel}
            options={filtered}
            hasAnyOptions={available.length > 0}
            query={query}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onChoose={choose}
            isLoading={isLoading}
            noun={noun}
            emptyLabel={emptyLabel}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A single-value event/screen field built on {@link EventPicker}: a labelled trigger showing the
 * current pick (or a placeholder), with an optional Clear. Used for the Retention born/return
 * events, the Flows anchor event, and the Paths anchor screen.
 */
export function EventSelectField({
  label,
  value,
  onChange,
  options,
  isLoading = false,
  noun = 'event',
  placeholder,
  allowClear = false,
  emptyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  isLoading?: boolean;
  noun?: string;
  placeholder?: string;
  allowClear?: boolean;
  emptyLabel?: ReactNode;
}) {
  const resolvedPlaceholder = placeholder ?? `Select ${noun}…`;
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <EventPicker
          options={options}
          onSelect={onChange}
          isLoading={isLoading}
          noun={noun}
          comboLabel={`Search ${noun}s`}
          emptyLabel={emptyLabel}
          triggerAriaLabel={label}
          triggerClassName="w-64 justify-between font-normal"
          triggerLabel={
            value ? (
              <span className="truncate">{value}</span>
            ) : (
              <span className="truncate text-text-muted">{resolvedPlaceholder}</span>
            )
          }
        />
        {allowClear && value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Clear ${label}`}
            onClick={() => onChange('')}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// --- Date-range presets -----------------------------------------------------------------------

export interface DatePreset {
  id: string;
  label: string;
  days: number;
}

/** The three quick ranges, plus a Custom escape hatch. Default is Last 30 days. */
export const DATE_PRESETS: DatePreset[] = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
];

/** Which preset (if any) a concrete from/to pair corresponds to — else `'custom'`. */
export function presetIdForRange(from: string, to: string): string {
  if (to !== defaultDate(0)) return 'custom';
  const match = DATE_PRESETS.find((preset) => defaultDate(preset.days) === from);
  return match ? match.id : 'custom';
}

/**
 * A segmented "Last 7 · 30 · 90 days · Custom" control. Picking a preset sets the whole range;
 * Custom reveals the existing from/to date inputs. The parent still owns the `from`/`to` strings, so
 * the produced §14/§15 `date_range` is byte-for-byte what the old two-input form produced.
 */
export function DateRangePresets({
  from,
  to,
  onChange,
  idPrefix,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  idPrefix: string;
}) {
  const [mode, setMode] = useState(() => presetIdForRange(from, to));

  const choose = (id: string) => {
    setMode(id);
    if (id === 'custom') return;
    const preset = DATE_PRESETS.find((entry) => entry.id === id);
    if (preset) onChange(defaultDate(preset.days), defaultDate(0));
  };

  const segments = [...DATE_PRESETS, { id: 'custom', label: 'Custom' }];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="mb-1 block text-sm font-medium">Date range</span>
        <div
          role="radiogroup"
          aria-label="Date range"
          className="inline-flex w-fit flex-wrap gap-0.5 rounded-lg border border-border bg-surface p-0.5"
        >
          {segments.map((segment) => {
            const active = mode === segment.id;
            return (
              <button
                key={segment.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(segment.id)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  active
                    ? 'bg-accent font-medium text-accent-fg'
                    : 'text-text-muted hover:bg-border/40 hover:text-text',
                )}
              >
                {segment.label}
              </button>
            );
          })}
        </div>
      </div>
      {mode === 'custom' && (
        <DateRangeFields
          idPrefix={idPrefix}
          from={from}
          to={to}
          onFrom={(next) => onChange(next, to)}
          onTo={(next) => onChange(from, next)}
        />
      )}
    </div>
  );
}

// --- Auto-run ----------------------------------------------------------------------------------

/**
 * Debounced auto-run: whenever `key` (a serialized query definition) changes and the query is
 * `enabled` (valid), fire `run` after `delayMs` of quiet. Replaces the explicit "Run" button so a
 * result is always on screen. `run` is read from a ref so a changing closure never re-arms the timer.
 */
export function useAutoRun({
  key,
  enabled,
  run,
  delayMs = 350,
}: {
  key: string;
  enabled: boolean;
  run: () => void;
  delayMs?: number;
}) {
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled) return;
    const id = window.setTimeout(() => runRef.current(), delayMs);
    return () => window.clearTimeout(id);
  }, [key, enabled, delayMs]);
}
