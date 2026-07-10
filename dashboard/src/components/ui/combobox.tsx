import { useEffect, type ReactNode, type RefObject } from 'react';
import { cn } from '../../lib/cn';

/** Case-insensitive substring filter shared by every combobox (event picker, filter value, …). */
export function filterOptions(options: string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  return needle ? options.filter((name) => name.toLowerCase().includes(needle)) : options;
}

/** Closes an open combobox popover when a pointerdown lands outside `containerRef`. */
export function useCloseComboboxOnOutsideClick(
  containerRef: RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, containerRef, onClose]);
}

/**
 * The shared `<ul role="listbox">` behind every combobox in the app: {@link EventPicker}'s
 * click-to-open popover (`features/analytics/components/explore-controls.tsx`) and the filter-value
 * suggestion dropdown (`features/analytics/components/builder-controls.tsx`). Renders a loading /
 * "nothing at all" / "no matches" state, or the filtered options with roving highlight + click-to-choose.
 */
export function ComboboxListbox({
  listId,
  comboLabel,
  options,
  hasAnyOptions,
  query,
  activeIndex,
  onHover,
  onChoose,
  isLoading = false,
  noun = 'option',
  emptyLabel,
  className,
}: {
  listId: string;
  comboLabel: string;
  /** Already filtered by `query`. */
  options: string[];
  /** Whether at least one option exists before filtering (distinguishes "none at all" from "no matches"). */
  hasAnyOptions: boolean;
  query: string;
  activeIndex: number;
  onHover: (index: number) => void;
  onChoose: (name: string) => void;
  isLoading?: boolean;
  noun?: string;
  emptyLabel?: ReactNode;
  className?: string;
}) {
  return (
    <ul
      id={listId}
      role="listbox"
      aria-label={comboLabel}
      className={cn(
        'mt-2 max-h-56 overflow-auto rounded-xl border border-border bg-surface-raised p-1 shadow-lift',
        className,
      )}
    >
      {isLoading ? (
        <li className="px-2 py-1.5 text-sm text-text-muted">Loading {noun}s…</li>
      ) : !hasAnyOptions ? (
        <li className="px-2 py-2 text-sm text-text-muted">
          {emptyLabel ?? `No ${noun}s tracked yet.`}
        </li>
      ) : options.length === 0 ? (
        <li className="px-2 py-1.5 text-sm text-text-muted">No matches for “{query.trim()}”.</li>
      ) : (
        options.map((name, index) => (
          <li
            key={name}
            id={`${listId}-opt-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            onPointerEnter={() => onHover(index)}
            onClick={() => onChoose(name)}
            className={cn(
              'cursor-pointer truncate rounded px-2 py-1.5 text-sm',
              index === activeIndex ? 'bg-accent-soft text-accent' : 'text-text hover:bg-border/40',
            )}
          >
            {name}
          </li>
        ))
      )}
    </ul>
  );
}
