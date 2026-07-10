import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type ComponentPropsWithoutRef, type MutableRefObject, type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';

/** `onSelect` lives in a ref so unstable (per-render) handlers never force re-registration —
 * registration order must stay stable or keyboard traversal desyncs from the visual order. */
type CommandItemEntry = { id: string; label: string; onSelectRef: MutableRefObject<(() => void) | undefined> };

/** Sort registered entries by their rendered DOM position so ArrowUp/Down always follows what the
 * user sees, regardless of the order effects (re-)registered the items in. */
function byDomOrder(entries: CommandItemEntry[]): CommandItemEntry[] {
  return [...entries].sort((a, b) => {
    const elA = document.getElementById(a.id);
    const elB = document.getElementById(b.id);
    if (!elA || !elB) return 0;
    return elA.compareDocumentPosition(elB) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

interface CommandContextValue {
  query: string; setQuery: (value: string) => void;
  activeId: string | null; setActiveId: (id: string) => void;
  listId: string; inputId: string;
  matches: (label: string) => boolean;
  register: (entry: CommandItemEntry) => () => void;
  moveActive: (direction: 1 | -1) => void; selectActive: () => void;
  hasVisibleItems: boolean;
}

const CommandContext = createContext<CommandContextValue | null>(null);

function useCommandContext(component: string): CommandContextValue {
  const context = useContext(CommandContext);
  if (!context) throw new Error(`${component} must be used inside <Command>`);
  return context;
}

/** Lets `CommandGroup` know which of its descendant items are visible for the current filter,
 * so a fully filtered-out group hides its heading. Returns an unsubscribe. */
const CommandGroupContext = createContext<((id: string, visible: boolean) => () => void) | null>(null);

/** Dependency-free combobox-list primitive (no `cmdk`): filter input over a `role="listbox"` of
 * `role="option"` rows, arrow-key/Enter nav via `aria-activedescendant`. Glass panel styling is
 * the consumer's job (see `CommandPalette`). */
export const Command = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className, children, ...props }, ref) => {
    const [query, setQuery] = useState('');
    const [activeId, setActiveIdState] = useState<string | null>(null);
    const itemsRef = useRef<CommandItemEntry[]>([]);
    const [version, setVersion] = useState(0);
    const listId = useId();
    const inputId = useId();
    const matches = useCallback(
      (label: string) => label.toLowerCase().includes(query.trim().toLowerCase()),
      [query],
    );
    // Items only register while visible, so the registry IS the visible set; `version` invalidates.
    const visibleCount = useMemo(() => {
      void version;
      return itemsRef.current.length;
    }, [version]);
    useEffect(() => {
      if (activeId && itemsRef.current.some((item) => item.id === activeId)) return;
      setActiveIdState(byDomOrder(itemsRef.current)[0]?.id ?? null);
    }, [version, activeId]);
    const register = useCallback((entry: CommandItemEntry) => {
      itemsRef.current = [...itemsRef.current.filter((item) => item.id !== entry.id), entry];
      setVersion((v) => v + 1);
      return () => {
        itemsRef.current = itemsRef.current.filter((item) => item.id !== entry.id);
        setVersion((v) => v + 1);
      };
    }, []);
    const moveActive = useCallback(
      (direction: 1 | -1) => {
        const ordered = byDomOrder(itemsRef.current);
        if (ordered.length === 0) return;
        const index = ordered.findIndex((item) => item.id === activeId);
        const next = (index + direction + ordered.length) % ordered.length;
        setActiveIdState(ordered[next]?.id ?? null);
      },
      [activeId],
    );
    const selectActive = useCallback(() => {
      itemsRef.current.find((item) => item.id === activeId)?.onSelectRef.current?.();
    }, [activeId]);
    const value = useMemo<CommandContextValue>(
      () => ({
        query, setQuery, activeId, setActiveId: setActiveIdState, listId, inputId, matches,
        register, moveActive, selectActive, hasVisibleItems: visibleCount > 0,
      }),
      [query, activeId, listId, inputId, matches, register, moveActive, selectActive, visibleCount],
    );

    return (
      <CommandContext.Provider value={value}>
        <div ref={ref} className={cn('flex flex-col', className)} {...props}>
          {children}
        </div>
      </CommandContext.Provider>
    );
  },
);
Command.displayName = 'Command';

export const CommandInput = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'>>(
  ({ className, onKeyDown, onChange, value, ...props }, ref) => {
    const ctx = useCommandContext('CommandInput');
    const handleKeyDown: NonNullable<ComponentPropsWithoutRef<'input'>['onKeyDown']> = (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); ctx.moveActive(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); ctx.moveActive(-1); }
      else if (event.key === 'Enter') { event.preventDefault(); ctx.selectActive(); }
      onKeyDown?.(event);
    };
    return (
      <input
        ref={ref}
        id={ctx.inputId}
        role="combobox"
        aria-expanded="true"
        aria-controls={ctx.listId}
        aria-activedescendant={ctx.activeId ?? undefined}
        autoComplete="off"
        value={value ?? ctx.query}
        onChange={(event) => { ctx.setQuery(event.target.value); onChange?.(event); }}
        onKeyDown={handleKeyDown}
        className={cn(
          'w-full bg-transparent px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-muted/60',
          className,
        )}
        {...props}
      />
    );
  },
);
CommandInput.displayName = 'CommandInput';

export const CommandList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => {
    const ctx = useCommandContext('CommandList');
    return (
      <div ref={ref} id={ctx.listId} role="listbox" className={cn('max-h-80 overflow-auto p-1', className)} {...props} />
    );
  },
);
CommandList.displayName = 'CommandList';

export interface CommandGroupProps extends ComponentPropsWithoutRef<'div'> { heading?: ReactNode }

export const CommandGroup = forwardRef<HTMLDivElement, CommandGroupProps>(
  ({ heading, className, children, ...props }, ref) => {
    // Children stay mounted (they render null while filtered out) and report visibility here, so
    // the group can drop its heading — and hide its wrapper — once every item is filtered out.
    const [visibility, setVisibility] = useState<Record<string, boolean>>({});
    const report = useCallback((id: string, visible: boolean) => {
      setVisibility((map) => (map[id] === visible ? map : { ...map, [id]: visible }));
      return () => setVisibility((map) => {
        const next = { ...map };
        delete next[id];
        return next;
      });
    }, []);
    const ids = Object.keys(visibility);
    const hidden = ids.length > 0 && ids.every((id) => !visibility[id]);
    return (
      <CommandGroupContext.Provider value={report}>
        <div ref={ref} role="group" hidden={hidden} className={cn('py-1', className)} {...props}>
          {!hidden && heading && (
            <div className="px-2 py-1.5 text-xs uppercase tracking-wide text-text-muted">{heading}</div>
          )}
          {children}
        </div>
      </CommandGroupContext.Provider>
    );
  },
);
CommandGroup.displayName = 'CommandGroup';

export const CommandEmpty = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className, children, ...props }, ref) => {
    const ctx = useCommandContext('CommandEmpty');
    if (ctx.hasVisibleItems) return null;
    return (
      <div ref={ref} role="presentation" className={cn('px-2 py-6 text-center text-sm text-text-muted', className)} {...props}>
        {children}
      </div>
    );
  },
);
CommandEmpty.displayName = 'CommandEmpty';

export interface CommandItemProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onSelect'> {
  value?: string; onSelect?: () => void;
}

export const CommandItem = forwardRef<HTMLDivElement, CommandItemProps>(
  ({ value, onSelect, className, children, ...props }, ref) => {
    const ctx = useCommandContext('CommandItem');
    const reportToGroup = useContext(CommandGroupContext);
    const id = useId();
    const label = value ?? (typeof children === 'string' ? children : '');
    const visible = ctx.matches(label);

    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;

    const register = ctx.register;
    useEffect(() => {
      if (!visible) return undefined;
      return register({ id, label, onSelectRef });
    }, [visible, id, label, register]);
    useEffect(() => reportToGroup?.(id, visible), [reportToGroup, id, visible]);

    if (!visible) return null;
    const active = ctx.activeId === id;

    return (
      <div
        ref={ref}
        id={id}
        role="option"
        aria-selected={active}
        data-active={active ? '' : undefined}
        onMouseEnter={() => ctx.setActiveId(id)}
        onClick={() => onSelect?.()}
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text outline-none',
          'data-[active]:bg-accent-soft data-[active]:text-accent',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
CommandItem.displayName = 'CommandItem';
