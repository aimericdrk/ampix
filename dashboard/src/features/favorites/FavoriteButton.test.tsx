import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FavoriteButton } from './FavoriteButton';

describe('FavoriteButton', () => {
  it('renders unfavorited by default with an accessible name', () => {
    render(<FavoriteButton name="Weekly checkouts" isFavorite={false} onToggle={() => {}} />);
    const button = screen.getByRole('button', { name: 'Favorite Weekly checkouts' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects a favorited state via aria-pressed', () => {
    render(<FavoriteButton name="Weekly checkouts" isFavorite onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Favorite Weekly checkouts' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<FavoriteButton name="Weekly checkouts" isFavorite={false} onToggle={onToggle} />);

    await userEvent.click(screen.getByRole('button', { name: 'Favorite Weekly checkouts' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('stops the click from bubbling, so it never triggers a wrapping clickable card/row/link', async () => {
    const onToggle = vi.fn();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <FavoriteButton name="Weekly checkouts" isFavorite={false} onToggle={onToggle} />
      </div>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Favorite Weekly checkouts' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('does not navigate (renders a type="button", not a submit or link)', () => {
    render(<FavoriteButton name="Weekly checkouts" isFavorite={false} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Favorite Weekly checkouts' })).toHaveAttribute(
      'type',
      'button',
    );
  });
});
