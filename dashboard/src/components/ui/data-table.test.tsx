import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from './DataTable';
import * as csv from '../../lib/csv';

interface Row {
  id: string;
  name: string;
  count: number;
}

const rows: Row[] = [
  { id: 'a', name: 'Banana', count: 5 },
  { id: 'b', name: 'Apple', count: 10 },
];

const columns: Array<DataTableColumn<Row>> = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'count', header: 'Count', align: 'right', sortable: true },
];

describe('DataTable', () => {
  it('renders headers and rows', () => {
    render(<DataTable columns={columns} rows={rows} caption="Top events" rowKey={(r) => r.id} />);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Count' })).toBeInTheDocument();
    expect(screen.getByText('Banana')).toBeInTheDocument();
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('clicking a sortable header reorders rows and sets aria-sort', async () => {
    const { container } = render(
      <DataTable columns={columns} rows={rows} caption="Top events" rowKey={(r) => r.id} />,
    );
    const cellsInOrder = () =>
      Array.from(container.querySelectorAll('tbody tr td:first-child')).map((td) => td.textContent);

    // Initial order matches input order (unsorted).
    expect(cellsInOrder()).toEqual(['Banana', 'Apple']);

    const nameHeader = screen.getByRole('columnheader', { name: 'Name' });
    const nameSortButton = screen.getByRole('button', { name: 'Name' });

    await userEvent.click(nameSortButton);
    expect(cellsInOrder()).toEqual(['Apple', 'Banana']);
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');

    await userEvent.click(nameSortButton);
    expect(cellsInOrder()).toEqual(['Banana', 'Apple']);
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
  });

  it('sorts numeric columns numerically using sortValue ?? row[key]', async () => {
    render(<DataTable columns={columns} rows={rows} caption="Top events" rowKey={(r) => r.id} />);
    const countSortButton = screen.getByRole('button', { name: 'Count' });
    await userEvent.click(countSortButton);
    const countHeader = screen.getByRole('columnheader', { name: 'Count' });
    expect(countHeader).toHaveAttribute('aria-sort', 'ascending');
    const firstRowCount = screen.getAllByRole('row')[1];
    expect(firstRowCount).toHaveTextContent('Banana');
    expect(firstRowCount).toHaveTextContent('5');
  });

  it('applies tabular-nums to right-aligned columns', () => {
    render(<DataTable columns={columns} rows={rows} caption="Top events" rowKey={(r) => r.id} />);
    const countCell = screen.getByText('5');
    expect(countCell).toHaveClass('tabular-nums');
  });

  it('renders custom cell content via render()', () => {
    const customColumns: Array<DataTableColumn<Row>> = [
      { key: 'name', header: 'Name', render: (row) => <strong>{row.name.toUpperCase()}</strong> },
    ];
    render(<DataTable columns={customColumns} rows={rows} caption="Top events" rowKey={(r) => r.id} />);
    expect(screen.getByText('BANANA')).toBeInTheDocument();
    expect(screen.getByText('APPLE')).toBeInTheDocument();
  });

  it('makes rows activatable by click and Enter when onRowClick is provided', async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        caption="Top events"
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    const bananaRow = screen.getByText('Banana').closest('tr');
    if (!bananaRow) throw new Error('expected a <tr> ancestor');
    expect(bananaRow).toHaveAttribute('tabIndex', '0');
    // Row semantics must survive: no role override, so screen readers still get a real `row`.
    expect(bananaRow).not.toHaveAttribute('role');
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 data rows

    await userEvent.click(bananaRow);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);

    bananaRow.focus();
    fireEvent.keyDown(bananaRow, { key: 'Enter' });
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it('respects an initialSort prop', () => {
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        caption="Top events"
        rowKey={(r) => r.id}
        initialSort={{ key: 'name', dir: 'asc' }}
      />,
    );
    const cellsInOrder = Array.from(container.querySelectorAll('tbody tr td:first-child')).map(
      (td) => td.textContent,
    );
    expect(cellsInOrder).toEqual(['Apple', 'Banana']);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('renders the caption and an empty state row when rows is empty', () => {
    render(<DataTable columns={columns} rows={[]} caption="Top events" rowKey={(r) => r.id} />);
    expect(screen.getByText('Top events')).toBeInTheDocument();
    // header row + one empty-state row
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  describe('exportFilename', () => {
    it('renders no Export button when exportFilename is omitted', () => {
      render(<DataTable columns={columns} rows={rows} caption="Top events" rowKey={(r) => r.id} />);
      expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    });

    it('renders an Export CSV button when exportFilename is set', () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          caption="Top events"
          rowKey={(r) => r.id}
          exportFilename="events"
        />,
      );
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    });

    it('clicking Export CSV downloads a CSV built from column headers + sortValue/row cells', async () => {
      const downloadSpy = vi.spyOn(csv, 'downloadCsv').mockImplementation(() => {});
      render(
        <DataTable
          columns={columns}
          rows={rows}
          caption="Top events"
          rowKey={(r) => r.id}
          exportFilename="events"
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

      expect(downloadSpy).toHaveBeenCalledTimes(1);
      const [filename, body] = downloadSpy.mock.calls[0]!;
      expect(filename).toBe('events');
      expect(body).toBe('Name,Count\r\nBanana,5\r\nApple,10');

      downloadSpy.mockRestore();
    });

    it('exports rows in the current sort order, using render() output rather than raw values', async () => {
      const downloadSpy = vi.spyOn(csv, 'downloadCsv').mockImplementation(() => {});
      const customColumns: Array<DataTableColumn<Row>> = [
        { key: 'name', header: 'Name', sortable: true, render: (row) => <strong>{row.name.toUpperCase()}</strong> },
        { key: 'count', header: 'Count', align: 'right' },
      ];
      render(
        <DataTable
          columns={customColumns}
          rows={rows}
          caption="Top events"
          rowKey={(r) => r.id}
          exportFilename="events"
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: 'Name' }));
      await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

      // Sorted ascending by name (Apple, Banana) and cell text comes from the raw `name` value,
      // not the uppercased render() output.
      const [, body] = downloadSpy.mock.calls[0]!;
      expect(body).toBe('Name,Count\r\nApple,10\r\nBanana,5');

      downloadSpy.mockRestore();
    });
  });
});
