import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';

/** Shared item styling so every menu row reads as one control set. */
export const MENU_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-text transition-colors ' +
  'hover:bg-border/50 focus:bg-border/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0 text-text-muted transition-transform', open && 'rotate-180')}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function menuItems(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
  );
}

interface MenuProps {
  /** Accessible name for the trigger and the menu (e.g. "Switch workspace"). */
  label: string;
  /** Visible content on the left of the trigger button. */
  trigger: ReactNode;
  triggerClassName?: string;
  /** Menu rows; `close` dismisses the menu after an action. */
  children: (args: { close: () => void }) => ReactNode;
}

/**
 * A small keyboard-navigable dropdown menu built on native elements — no menu
 * dependency. Arrow/Home/End move between `role="menuitem"` rows, Escape closes
 * and restores focus to the trigger, and a pointer-down outside dismisses it.
 */
export function Menu({ label, trigger, triggerClassName, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = () => setOpen(false);

  // Move focus into the menu once it opens so keyboard users land on the first row.
  useEffect(() => {
    if (!open) return;
    menuItems(menuRef.current)[0]?.focus();
  }, [open]);

  // A pointer press anywhere outside dismisses the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      if (!open) {
        event.preventDefault();
        setOpen(true);
      }
    }
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left transition-colors',
          'hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          triggerClassName,
        )}
      >
        <span className="min-w-0 flex-1">{trigger}</span>
        <ChevronDown open={open} />
      </button>

      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          {children({ close })}
        </div>
      )}
    </div>
  );
}

/** A checkmark shown on the currently-selected menu row. */
export function MenuCheck({ hidden }: { hidden?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0 text-accent', hidden && 'invisible')}
    >
      <path d="m5 12 5 5L20 6" />
    </svg>
  );
}
