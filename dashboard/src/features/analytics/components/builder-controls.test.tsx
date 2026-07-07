import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
        propertyNames={['plan', 'email']}
        projectId={props.projectId}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onChange };
}

describe('FilterRows value type-ahead', () => {
  it('populates the value input datalist with the suggested values for the chosen property', async () => {
    signIn();
    const { container } = renderFilterRows({
      projectId: TEST_PROJECT.id,
      filters: [{ property: 'plan', op: 'eq', value: '' }],
    });

    const input = screen.getByLabelText('Filter value 1');

    // Once the async /meta/property-values query resolves, the input points at a datalist whose
    // options are the fixture's suggested values.
    await waitFor(() => expect(input).toHaveAttribute('list', 'test-filter-value-0-options'));
    const options = Array.from(container.querySelectorAll('datalist option')).map((o) =>
      o.getAttribute('value'),
    );
    expect(options).toEqual(['free', 'pro', 'enterprise']);
  });

  it('falls back to free text with a hint when the property has no suggestions', async () => {
    signIn();
    const { container } = renderFilterRows({
      projectId: TEST_PROJECT.id,
      filters: [{ property: 'email', op: 'eq', value: '' }],
    });

    // The free-form key resolves to an empty list → the "Type any value" hint appears and the
    // input carries no `list` (no datalist to attach to).
    await screen.findByText('Type any value');
    const input = screen.getByLabelText('Filter value 1');
    expect(input).not.toHaveAttribute('list');
    expect(container.querySelector('datalist')).toBeNull();
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
});
