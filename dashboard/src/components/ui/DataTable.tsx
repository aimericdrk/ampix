import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { downloadCsv, toCsv } from '../../lib/csv';
import { Button } from './button';

export interface DataTableColumn<T> {
  /** Unique column key; also the property read off each row when `render`/`sortValue` are omitted. */
  key: string;
  header: string;
  align?: 'left' | 'right';
  /** Whether clicking the header toggles sorting by this column. */
  sortable?: boolean;
  /** Custom cell renderer; defaults to `row[key]`. */
  render?: (row: T) => ReactNode;
  /** Value used for sorting; defaults to `row[key]`. */
  sortValue?: (row: T) => string | number;
}

export interface DataTableSort {
  key: string;
  dir: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  /** Accessible table description, rendered as a visually-hidden `<caption>`. */
  caption: string;
  initialSort?: DataTableSort;
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string;
  /**
   * When set, renders an "Export CSV" button that downloads the table's current columns/rows
   * (post-sort) as `${exportFilename}.csv`. Omit to keep the table exactly as before.
   */
  exportFilename?: string;
}

function getCellValue<T>(row: T, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}

function getSortValue<T>(row: T, column: DataTableColumn<T>): string | number {
  if (column.sortValue) return column.sortValue(row);
  return getCellValue(row, column.key) as string | number;
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/** Cell text for CSV export: the column's `sortValue` when present, else `row[key]` — mirrors
 * `getSortValue` but always coerced to a string, and deliberately ignores `render` (which may
 * produce JSX unsuitable for a CSV cell). */
function getCsvCellText<T>(row: T, column: DataTableColumn<T>): string {
  if (column.sortValue) return String(column.sortValue(row));
  return String(getCellValue(row, column.key));
}

function buildCsv<T>(columns: Array<DataTableColumn<T>>, rows: T[]): string {
  const headers = columns.map((column) => column.header);
  const body = rows.map((row) => columns.map((column) => getCsvCellText(row, column)));
  return toCsv(headers, body);
}

/**
 * A generic sortable, keyboard-accessible `<table>` used for top-events/top-screens/breakdown
 * tables (and the user-search disambiguation view). Sorting is local: clicking a `sortable`
 * header toggles asc/desc and reflects the active column via `aria-sort`. When `onRowClick` is
 * provided, rows become activatable by click, Enter, and Space (`tabIndex`/`onKeyDown` on the
 * `<tr>`) in addition to the mouse — the row keeps its native `row` role rather than being
 * overridden to `button`, so row/cell semantics (and screen-reader table navigation) stay intact.
 */
export function DataTable<T>({
  columns,
  rows,
  caption,
  initialSort,
  onRowClick,
  rowKey,
  exportFilename,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<DataTableSort | undefined>(initialSort);

  const sortedRows = sort ? sortRows(rows, columns, sort) : rows;

  const handleExport = () => {
    if (!exportFilename) return;
    downloadCsv(exportFilename, buildCsv(columns, sortedRows));
  };

  const toggleSort = (column: DataTableColumn<T>) => {
    if (!column.sortable) return;
    setSort((prev) =>
      prev?.key === column.key
        ? { key: column.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, dir: 'asc' },
    );
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (!onRowClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick(row);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {exportFilename && (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={handleExport}>
            Export CSV
          </Button>
        </div>
      )}
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => {
              const isSorted = sort?.key === column.key;
              const ariaSort = column.sortable
                ? isSorted
                  ? sort!.dir === 'asc'
                    ? ('ascending' as const)
                    : ('descending' as const)
                  : ('none' as const)
                : undefined;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    // top-12 (48px) clears the mobile fixed topbar in AppLayout (py-2 + h-8
                    // button) on <md screens; z-10 stays above rows, below the topbar's z-30.
                    'sticky top-12 z-10 bg-surface/80 py-2 text-xs font-medium uppercase tracking-wide text-text-muted backdrop-blur md:top-0',
                    column.align === 'right' && 'text-right',
                  )}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className="inline-flex items-center gap-1"
                    >
                      {column.header}
                      {isSorted && (
                        <span aria-hidden className="text-text-muted">
                          {sort!.dir === 'asc' ? '▲' : '▼'}
                        </span>
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr className="border-b border-border">
              <td colSpan={columns.length || 1} className="py-4 text-center text-text-muted">
                No data
              </td>
            </tr>
          ) : (
            sortedRows.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  'border-b border-border transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-accent-soft/50',
                )}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (event) => handleRowKeyDown(event, row) : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'py-2 pr-2',
                      column.align === 'right' && 'text-right tabular-nums',
                    )}
                  >
                    {column.render ? column.render(row) : (getCellValue(row, column.key) as ReactNode)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function sortRows<T>(rows: T[], columns: Array<DataTableColumn<T>>, sort: DataTableSort): T[] {
  const column = columns.find((c) => c.key === sort.key);
  if (!column) return rows;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const cmp = compareValues(getSortValue(a.row, column), getSortValue(b.row, column));
      const signed = sort.dir === 'asc' ? cmp : -cmp;
      // Stable tie-break: preserve original relative order for equal values.
      return signed !== 0 ? signed : a.index - b.index;
    })
    .map((entry) => entry.row);
}
