import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { InsightsFilter } from '../../lib/api/types';
import { GlobalFiltersProvider, mergeGlobalFilters, useGlobalFilters } from './global-filters';

const PROJECT_ID = 'proj-1';

function Probe() {
  const { filters, addFilter, removeFilter, clearAll, setFilters, toggleGlobalFilter } =
    useGlobalFilters();
  return (
    <div>
      <span data-testid="count">{filters.length}</span>
      <ul>
        {filters.map((f, i) => (
          <li key={i} data-testid={`filter-${i}`}>
            {f.property} {f.op} {f.value ?? ''} {f.target ?? ''}
          </li>
        ))}
      </ul>
      <button onClick={() => addFilter({ property: 'os', op: 'eq', value: 'ios' })}>
        Add OS filter
      </button>
      <button onClick={() => addFilter({ property: 'app_version', op: 'is_set' })}>
        Add version filter
      </button>
      <button onClick={() => removeFilter(0)}>Remove first</button>
      <button onClick={() => clearAll()}>Clear all</button>
      <button onClick={() => setFilters([{ property: 'plan', op: 'eq', value: 'pro' }])}>
        Set to plan filter
      </button>
      <button onClick={() => toggleGlobalFilter({ property: 'os', op: 'eq', value: 'ios' })}>
        Toggle OS ios
      </button>
      <button onClick={() => toggleGlobalFilter({ property: 'os', op: 'eq', value: 'android' })}>
        Toggle OS android
      </button>
    </div>
  );
}

describe('GlobalFiltersProvider / useGlobalFilters', () => {
  it('defaults to no filters', () => {
    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );

    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('adds a filter and persists it to localStorage under the project-scoped key', async () => {
    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add OS filter' }));

    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('filter-0')).toHaveTextContent('os eq ios');

    const stored = JSON.parse(
      localStorage.getItem(`myampix:globalfilters:${PROJECT_ID}`) ?? 'null',
    );
    expect(stored).toEqual([{ property: 'os', op: 'eq', value: 'ios' }]);
  });

  it('adds a value-less filter without a value key', async () => {
    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add version filter' }));

    expect(screen.getByTestId('filter-0')).toHaveTextContent('app_version is_set');
    const stored = JSON.parse(
      localStorage.getItem(`myampix:globalfilters:${PROJECT_ID}`) ?? 'null',
    );
    expect(stored).toEqual([{ property: 'app_version', op: 'is_set' }]);
  });

  it('removes a filter by index', async () => {
    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add OS filter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add version filter' }));
    expect(screen.getByTestId('count')).toHaveTextContent('2');

    await userEvent.click(screen.getByRole('button', { name: 'Remove first' }));

    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('filter-0')).toHaveTextContent('app_version is_set');
  });

  it('clears all filters at once', async () => {
    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add OS filter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(screen.getByTestId('count')).toHaveTextContent('0');
    const stored = JSON.parse(
      localStorage.getItem(`myampix:globalfilters:${PROJECT_ID}`) ?? 'null',
    );
    expect(stored).toEqual([]);
  });

  it('reads a previously persisted filter set for the project on mount', () => {
    localStorage.setItem(
      `myampix:globalfilters:${PROJECT_ID}`,
      JSON.stringify([{ property: 'plan', op: 'eq', value: 'enterprise' }]),
    );

    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );

    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('filter-0')).toHaveTextContent('plan eq enterprise');
  });

  it("preserves a filter's profile target across a persist → reload round-trip", () => {
    localStorage.setItem(
      `myampix:globalfilters:${PROJECT_ID}`,
      JSON.stringify([{ property: '$rc_status', op: 'eq', value: 'active', target: 'profile' }]),
    );

    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );

    // Without preserving `target`, the reloaded filter silently degrades to an event-target filter.
    expect(screen.getByTestId('filter-0')).toHaveTextContent('$rc_status eq active profile');
  });

  it('scopes persistence per project — switching projects never leaks the previous filters', async () => {
    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add OS filter' }));

    expect(localStorage.getItem('myampix:globalfilters:other-project')).toBeNull();
    expect(localStorage.getItem(`myampix:globalfilters:${PROJECT_ID}`)).not.toBeNull();
  });

  it('re-reads the persisted set when the project prop changes without unmounting', async () => {
    localStorage.setItem(
      'myampix:globalfilters:other-project',
      JSON.stringify([{ property: 'os', op: 'eq', value: 'android' }]),
    );

    const { rerender } = render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add OS filter' }));
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    rerender(
      <GlobalFiltersProvider projectId="other-project">
        <Probe />
      </GlobalFiltersProvider>,
    );

    expect(screen.getByTestId('filter-0')).toHaveTextContent('os eq android');
    // The first project's own filter is untouched.
    expect(
      JSON.parse(localStorage.getItem(`myampix:globalfilters:${PROJECT_ID}`) ?? 'null'),
    ).toEqual([{ property: 'os', op: 'eq', value: 'ios' }]);
  });

  it('throws when useGlobalFilters is used outside a GlobalFiltersProvider', () => {
    const Bare = () => {
      useGlobalFilters();
      return null;
    };
    expect(() => render(<Bare />)).toThrow(
      'useGlobalFilters must be used within a GlobalFiltersProvider',
    );
  });
});

describe('toggleGlobalFilter (feat-03 §3.2/§4)', () => {
  it('adds a filter that is not currently active', async () => {
    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Toggle OS ios' }));

    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('filter-0')).toHaveTextContent('os eq ios');
  });

  it('removes the filter when the identical {property,op,value} is toggled again', async () => {
    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Toggle OS ios' }));
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    await userEvent.click(screen.getByRole('button', { name: 'Toggle OS ios' }));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('replaces the value in place when a same-property eq filter is already active with a different value', async () => {
    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Toggle OS ios' }));
    await userEvent.click(screen.getByRole('button', { name: 'Toggle OS android' }));

    // Never a contradictory os=ios AND os=android — replaced in place, still a single filter.
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('filter-0')).toHaveTextContent('os eq android');
  });

  it('leaves an unrelated filter untouched while toggling a same-property one', async () => {
    render(
      <GlobalFiltersProvider projectId={PROJECT_ID}>
        <Probe />
      </GlobalFiltersProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add version filter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Toggle OS ios' }));
    await userEvent.click(screen.getByRole('button', { name: 'Toggle OS android' }));

    expect(screen.getByTestId('count')).toHaveTextContent('2');
    expect(screen.getByTestId('filter-0')).toHaveTextContent('app_version is_set');
    expect(screen.getByTestId('filter-1')).toHaveTextContent('os eq android');
  });
});

describe('mergeGlobalFilters', () => {
  it('appends global filters after local ones', () => {
    const local: InsightsFilter[] = [{ property: 'app_version', op: 'eq', value: '1.4.0' }];
    const global: InsightsFilter[] = [{ property: 'os', op: 'eq', value: 'ios' }];

    expect(mergeGlobalFilters(local, global)).toEqual([...local, ...global]);
  });

  it('dedupes an exact {property, op, value} duplicate between local and global', () => {
    const local: InsightsFilter[] = [{ property: 'os', op: 'eq', value: 'ios' }];
    const global: InsightsFilter[] = [
      { property: 'os', op: 'eq', value: 'ios' },
      { property: 'plan', op: 'eq', value: 'pro' },
    ];

    expect(mergeGlobalFilters(local, global)).toEqual([
      { property: 'os', op: 'eq', value: 'ios' },
      { property: 'plan', op: 'eq', value: 'pro' },
    ]);
  });

  it('does not dedupe the same property/op with a different value', () => {
    const local: InsightsFilter[] = [{ property: 'os', op: 'eq', value: 'ios' }];
    const global: InsightsFilter[] = [{ property: 'os', op: 'eq', value: 'android' }];

    expect(mergeGlobalFilters(local, global)).toEqual([...local, ...global]);
  });

  it('drops incomplete rows from both sides via cleanFilters', () => {
    const local: InsightsFilter[] = [{ property: '', op: 'eq', value: 'ios' }];
    const global: InsightsFilter[] = [{ property: 'os', op: 'eq', value: '' }];

    expect(mergeGlobalFilters(local, global)).toEqual([]);
  });

  it('strips the ignored value from value-less ops on both sides', () => {
    const local: InsightsFilter[] = [{ property: 'os', op: 'is_set', value: 'ignored' }];
    const global: InsightsFilter[] = [{ property: 'app_version', op: 'is_not_set', value: 'ignored' }];

    expect(mergeGlobalFilters(local, global)).toEqual([
      { property: 'os', op: 'is_set' },
      { property: 'app_version', op: 'is_not_set' },
    ]);
  });

  it('returns an empty array when both inputs are empty', () => {
    expect(mergeGlobalFilters([], [])).toEqual([]);
  });
});
