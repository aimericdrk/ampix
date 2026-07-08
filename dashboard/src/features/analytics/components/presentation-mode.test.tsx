import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PresentationMode } from './PresentationMode';

function renderPresentation(overrides: Partial<Parameters<typeof PresentationMode>[0]> = {}) {
  const onClose = vi.fn();
  const onRefresh = vi.fn();
  const restoreFocusRef = createRef<HTMLButtonElement>();
  render(
    <PresentationMode
      dashboardName="Growth board"
      tiles={[]}
      results={new Map()}
      loading={false}
      onRefresh={onRefresh}
      onClose={onClose}
      restoreFocusRef={restoreFocusRef}
      {...overrides}
    />,
  );
  return { onClose, onRefresh };
}

describe('PresentationMode', () => {
  it('renders a fullscreen dialog with the dashboard name and presentation controls', () => {
    renderPresentation();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Growth board' })).toBeInTheDocument();
    expect(screen.getByLabelText('Refresh interval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit presentation' })).toBeInTheDocument();
    // Empty board → the friendly no-tiles state.
    expect(screen.getByText('No tiles yet')).toBeInTheDocument();
  });

  it('closes via the Exit button', async () => {
    const { onClose } = renderPresentation();
    await userEvent.click(screen.getByRole('button', { name: 'Exit presentation' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const { onClose } = renderPresentation();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('triggers a data refetch via the manual Refresh button', async () => {
    const { onRefresh } = renderPresentation();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalled();
  });
});
