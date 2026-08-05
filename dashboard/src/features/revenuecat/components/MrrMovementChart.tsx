import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { colorForIndex, SERIES_OTHER_COLOR_VAR } from '../../analytics/palette';
import { formatCompactNumber, formatCurrency } from '../../analytics/format';
import { downloadCsv, toCsv } from '../../../lib/csv';
import {
  axisProps,
  ChartTooltip,
  gridProps,
  useChartAnimationProps,
} from '../../analytics/components/charts/chart-theme';
import type { RcGranularity, RcMrrMovementBucket, RcMrrMovementTotals } from '../purchase-metrics-api';

type MovementKey =
  | 'new_cents'
  | 'reactivation_cents'
  | 'expansion_cents'
  | 'contraction_cents'
  | 'churn_cents';

interface Category {
  key: MovementKey;
  label: string;
  color: string;
}

/** The five stacked categories: gains (New / Reactivation / Expansion) sit above zero, losses
 *  (Contraction / Churn) below — so gain-vs-loss is encoded by position, never by color alone. */
const CATEGORIES: Category[] = [
  { key: 'new_cents', label: 'New', color: colorForIndex(0) },
  { key: 'reactivation_cents', label: 'Reactivation', color: colorForIndex(1) },
  { key: 'expansion_cents', label: 'Expansion', color: colorForIndex(2) },
  { key: 'contraction_cents', label: 'Contraction', color: colorForIndex(3) },
  { key: 'churn_cents', label: 'Churn', color: colorForIndex(4) },
];

const NET_KEY = 'net_cents';
const NET_COLOR = SERIES_OTHER_COLOR_VAR;

/** Default-visible series — deliberately a subset (New, Churn, Net), so the chart doesn't show all
 *  categories at once; the rest are one click away in the legend. */
const DEFAULT_VISIBLE = new Set<string>(['new_cents', 'churn_cents', NET_KEY]);

const ALL_KEYS: string[] = [...CATEGORIES.map((c) => c.key), NET_KEY];

/** Restore the persisted visible set for a chart instance, falling back to the default subset. An
 *  unavailable/corrupt localStorage (private mode, quota, bad JSON) must never break rendering. */
function loadVisible(persistKey: string | undefined): Set<string> {
  if (!persistKey) return new Set(DEFAULT_VISIBLE);
  try {
    const raw = window.localStorage.getItem(persistKey);
    if (!raw) return new Set(DEFAULT_VISIBLE);
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((k) => typeof k === 'string' && ALL_KEYS.includes(k))) {
      return new Set(parsed as string[]);
    }
  } catch {
    // ignore — fall through to the default
  }
  return new Set(DEFAULT_VISIBLE);
}

const CSV_HEADERS = ['Period', 'New', 'Reactivation', 'Expansion', 'Contraction', 'Churn', 'Net'];

/** Per-bucket movement as a CSV string in currency units (2 decimals, signed) — pure, so it's
 *  unit-testable without touching the DOM. */
export function buildMovementCsv(buckets: RcMrrMovementBucket[]): string {
  const money = (cents: number) => (cents / 100).toFixed(2);
  const rows = buckets.map((b) => [
    b.bucket.slice(0, 10),
    money(b.new_cents),
    money(b.reactivation_cents),
    money(b.expansion_cents),
    money(b.contraction_cents),
    money(b.churn_cents),
    money(b.net_cents),
  ]);
  return toCsv(CSV_HEADERS, rows);
}

function formatBucketLabel(iso: string, granularity: RcGranularity): string {
  const date = new Date(iso);
  if (granularity === 'month') {
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export interface MrrMovementChartProps {
  buckets: RcMrrMovementBucket[];
  totals: RcMrrMovementTotals;
  currency: string | null;
  granularity: RcGranularity;
  height?: number;
  /** When set, the user's shown/hidden categories persist to `localStorage` under this key (e.g.
   *  per project), so their view survives reloads and project switches. Omit for ephemeral state. */
  persistKey?: string;
}

/**
 * MRR Movement — a stacked bar per bucket (gains up, losses down) with a Net line overlaid, plus a
 * toggleable legend so the categories aren't all shown at once. Built entirely on the dashboard's
 * own chart theme (recharts + `chart-theme`), not a copy of any third-party chart's visuals.
 */
export function MrrMovementChart({
  buckets,
  totals,
  currency,
  granularity,
  height = 320,
  persistKey,
}: MrrMovementChartProps) {
  const [visible, setVisible] = useState<Set<string>>(() => loadVisible(persistKey));
  const animation = useChartAnimationProps();
  const code = currency ?? 'USD';

  // Persist alongside the state update so a reload / project switch restores the same view.
  const commit = (next: Set<string>) => {
    setVisible(next);
    if (persistKey) {
      try {
        window.localStorage.setItem(persistKey, JSON.stringify([...next]));
      } catch {
        // best-effort only — an unavailable localStorage must never break interaction
      }
    }
  };

  const toggle = (key: string) => {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    commit(next);
  };

  const showAll = () => commit(new Set(ALL_KEYS));
  const reset = () => commit(new Set(DEFAULT_VISIBLE));
  const allVisible = ALL_KEYS.every((k) => visible.has(k));
  const exportCsv = () => downloadCsv('mrr-movement', buildMovementCsv(buckets));

  // cents → currency, compact on the axis (e.g. "$1.2k"), exact in the tooltip.
  const axisTick = (cents: number) => `${cents < 0 ? '-' : ''}$${formatCompactNumber(Math.abs(cents) / 100)}`;
  const tooltipValue = (cents: number) => formatCurrency(cents / 100, code);

  // Signed currency total for a category (e.g. "+$29.97" / "−$9.99"), so each chip doubles as a
  // summary of the period — a gain leads with "+", a loss keeps the formatter's minus sign.
  const signed = (cents: number) => (cents > 0 ? `+${formatCurrency(cents / 100, code)}` : formatCurrency(cents / 100, code));

  const legend = useMemo(() => [...CATEGORIES, { key: NET_KEY, label: 'Net', color: NET_COLOR }], []);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
      <ul className="flex flex-wrap gap-2" aria-label="Movement categories — toggle to show or hide">
        {legend.map((item) => {
          const on = visible.has(item.key);
          const total = totals[item.key as keyof RcMrrMovementTotals];
          return (
            <li key={item.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(item.key)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  on
                    ? 'border-border bg-surface-raised text-text'
                    : 'border-border/60 bg-transparent text-text-muted opacity-60 hover:opacity-100'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: on ? item.color : 'var(--text-muted)' }}
                />
                {item.label}
                <span className="tabular-nums text-text-muted">{signed(total)}</span>
              </button>
            </li>
          );
        })}
      </ul>
        <button
          type="button"
          onClick={allVisible ? reset : showAll}
          className="ml-1 rounded-full px-2 py-1 text-xs font-medium text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          {allVisible ? 'Reset' : 'Show all'}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={buckets.length === 0}
          className="ml-auto rounded-full border border-border px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            {...axisProps}
            dataKey="bucket"
            tickFormatter={(value: string) => formatBucketLabel(value, granularity)}
            minTickGap={24}
          />
          <YAxis {...axisProps} tickFormatter={axisTick} width={56} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            cursor={{ fill: 'var(--surface-raised)', opacity: 0.4 }}
            content={
              <ChartTooltip
                labelFormatter={(value) => formatBucketLabel(String(value), granularity)}
                formatter={(value, name) => [tooltipValue(Number(value)), name as string]}
              />
            }
          />
          {CATEGORIES.filter((c) => visible.has(c.key)).map((c) => (
            <Bar
              key={c.key}
              dataKey={c.key}
              name={c.label}
              stackId="movement"
              fill={c.color}
              maxBarSize={40}
              {...animation}
            />
          ))}
          {visible.has(NET_KEY) && (
            <Line
              type="monotone"
              dataKey={NET_KEY}
              name="Net"
              stroke={NET_COLOR}
              strokeWidth={2}
              dot={false}
              {...animation}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <p className="mt-2 text-xs text-text-muted">
        Approximate — movement is derived from subscription and transaction snapshots at each period
        boundary, in {code}.
      </p>
    </div>
  );
}
