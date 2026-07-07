import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InsightsFilter } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { FilterRows } from './builder-controls';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

/** Render `FilterRows` with a fresh, retry-free QueryClient so failures don't hang the async assertions. */
function renderFilterRows(props: {
  filters: InsightsFilter[];
  onChange?: (filters: InsightsFilter[]) => void;
  projectId?: string;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = props.onChange ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <FilterRows
        idPrefix="test-filter"
        ariaLabel="Filter"
        filters={props.filters}
        onChange={onChange}
        propertyNames={['plan', 'os', 'email']}
        projectId={props.projectId}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onChange };
}

describe('FilterRows value combobox', () => {
  it('opens a visible listbox of suggested values and commits a pick', async () => {
    signIn();
    const onChange = vi.fn();
    renderFilterRows({
      projectId: TEST_PROJECT.id,
      filters: [{ property: 'os', op: 'eq', value: '' }],
      onChange,
    });

    const input = screen.getByLabelText('Filter value 1');

    // Once the async /meta/property-values query resolves, the field becomes a combobox.
    await waitFor(() => expect(input).toHaveAttribute('role', 'combobox'));
    // Before the listbox is open, aria-controls must not reference a not-yet-rendered element.
    expect(input).not.toHaveAttribute('aria-controls');
    await userEvent.click(input);

    const listbox = await screen.findByRole('listbox');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    const options = within(listbox)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['ios', 'android']);

    await userEvent.click(within(listbox).getByRole('option', { name: 'ios' }));
    expect(onChange).toHaveBeenCalledWith([{ property: 'os', op: 'eq', value: 'ios' }]);
  });

  it('reopens the listbox on a click after it was dismissed with Escape', async () => {
    signIn();
    const onChange = vi.fn();
    renderFilterRows({
      projectId: TEST_PROJECT.id,
      filters: [{ property: 'os', op: 'eq', value: '' }],
      onChange,
    });

    const input = screen.getByLabelText('Filter value 1');
    await waitFor(() => expect(input).toHaveAttribute('role', 'combobox'));
    await userEvent.click(input);
    await screen.findByRole('listbox');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).not.toHaveAttribute('aria-controls');

    await userEvent.click(input);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  it('lets the user type an arbitrary value even when suggestions exist', async () => {
    signIn();
    const onChange = vi.fn();
    renderFilterRows({
      projectId: TEST_PROJECT.id,
      filters: [{ property: 'plan', op: 'eq', value: '' }],
      onChange,
    });

    const input = screen.getByLabelText('Filter value 1');
    await userEvent.type(input, 'x');

    expect(onChange).toHaveBeenCalledWith([{ property: 'plan', op: 'eq', value: 'x' }]);
  });

  it('shows a format-example hint (and still accepts free text) when the property has no suggestions', async () => {
    signIn();
    const onChange = vi.fn();
    const { container } = renderFilterRows({
      projectId: TEST_PROJECT.id,
      filters: [{ property: 'email', op: 'eq', value: '' }],
      onChange,
    });

    // The free-form key resolves to an empty list → a `e.g. …` hint appears and no listbox renders.
    await screen.findByText(/e\.g\./);
    const input = screen.getByLabelText('Filter value 1');
    expect(input).not.toHaveAttribute('role', 'combobox');
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    await userEvent.type(input, 'x');
    expect(onChange).toHaveBeenCalledWith([{ property: 'email', op: 'eq', value: 'x' }]);
  });
});
