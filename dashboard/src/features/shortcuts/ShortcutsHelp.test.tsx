import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutsHelp } from './ShortcutsHelp';
import { SHORTCUT_ROUTES } from './keyboard-shortcuts';

describe('ShortcutsHelp', () => {
  it('renders nothing when closed', () => {
    render(<ShortcutsHelp open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a modal dialog listing every navigation shortcut and the general shortcuts', () => {
    render(<ShortcutsHelp open onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument();

    for (const route of SHORTCUT_ROUTES) {
      expect(screen.getByText(route.label)).toBeInTheDocument();
    }
    expect(screen.getByText('Show this help')).toBeInTheDocument();
    // Both ⌘K and "/" open the same command palette — two rows share this label.
    expect(screen.getAllByText('Open command palette')).toHaveLength(2);
    expect(screen.getByText('Close dialog')).toBeInTheDocument();
  });

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn();
    render(<ShortcutsHelp open onClose={onClose} />);

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('calls onClose when clicking the backdrop', async () => {
    const onClose = vi.fn();
    const { baseElement } = render(<ShortcutsHelp open onClose={onClose} />);

    const overlay = baseElement.querySelector('.fixed.inset-0');
    expect(overlay).toBeTruthy();
    if (overlay) await userEvent.click(overlay);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
