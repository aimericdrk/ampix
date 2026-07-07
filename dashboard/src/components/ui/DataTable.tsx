import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

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
}: DataTableProps<T>) {
  const [sort, setSort] = useState<DataTableSort | undefined>(initialSort);

  const sortedRows = sort ? sortRows(rows, columns, sort) : rows;

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
                className={cn('py-2 font-medium', column.align === 'right' && 'text-right')}
              >
                {column.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(column)}
                    className="inline-flex items-center gap-1 font-medium"
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
                'border-b border-border',
                onRowClick && 'cursor-pointer hover:bg-border/20',
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
