import type { MouseEvent } from 'react';
import { Button } from '../../components/ui/button';
import { IconStar } from '../../components/ui/icons';
import { cn } from '../../lib/cn';

/**
 * The star toggle (feat-13 §3) dropped into report/dashboard cards, cohort rows, and the user
 * profile header. A real `<button>` with `aria-pressed` + an accessible "Favorite <name>" name, so
 * it's independently operable by keyboard/screen reader even when it lives inside a clickable
 * card/row. `stopPropagation` on both mouse and keyboard activation keeps the wrapping Link/onClick
 * from ever firing — starring never navigates.
 */
export function FavoriteButton({
  name,
  isFavorite,
  onToggle,
  className,
}: {
  name: string;
  isFavorite: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const stopAndToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={isFavorite}
      aria-label={`Favorite ${name}`}
      onClick={stopAndToggle}
      className={cn('px-2', className)}
    >
      <IconStar filled={isFavorite} className={isFavorite ? 'text-accent' : undefined} />
    </Button>
  );
}
