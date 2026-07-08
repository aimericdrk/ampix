import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../annotations';
import { AnnotationsManager } from './AnnotationsManager';

function renderManager(annotations: Annotation[] = []) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(<AnnotationsManager annotations={annotations} onAdd={onAdd} onRemove={onRemove} />);
  return { onAdd, onRemove };
}

describe('AnnotationsManager', () => {
  it('starts closed, showing just the "Notes" button', () => {
    renderManager();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Chart annotations' })).not.toBeInTheDocument();
  });

  it('shows the annotation count on the trigger button', () => {
    renderManager([{ id: 'a', date: '2026-06-30', label: 'v1.4 release' }]);
    expect(screen.getByRole('button', { name: 'Notes (1)' })).toBeInTheDocument();
  });

  it('opens the panel, lists the given notes, and reports "No notes yet" when empty', async () => {
    renderManager();
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    const panel = screen.getByRole('region', { name: 'Chart annotations' });
    expect(within(panel).getByText('No notes yet.')).toBeInTheDocument();
  });

  it('submits date + label via onAdd, and clears the label field', async () => {
    const { onAdd } = renderManager();
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    const panel = screen.getByRole('region', { name: 'Chart annotations' });

    const labelInput = within(panel).getByPlaceholderText('e.g. v1.4 release');
    await userEvent.type(labelInput, 'v1.4 release');
    await userEvent.click(within(panel).getByRole('button', { name: 'Add note' }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'v1.4 release', date: expect.any(String) }),
    );
    expect(labelInput).toHaveValue('');
  });

  it('disables Add note and never calls onAdd with a blank label', async () => {
    const { onAdd } = renderManager();
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    const panel = screen.getByRole('region', { name: 'Chart annotations' });

    expect(within(panel).getByRole('button', { name: 'Add note' })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('calls onRemove with the annotation id', async () => {
    const { onRemove } = renderManager([{ id: 'note-1', date: '2026-06-30', label: 'Pricing change' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Notes (1)' }));
    const panel = screen.getByRole('region', { name: 'Chart annotations' });

    expect(within(panel).getByText('Pricing change')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Remove Pricing change' }));

    expect(onRemove).toHaveBeenCalledWith('note-1');
  });
});
