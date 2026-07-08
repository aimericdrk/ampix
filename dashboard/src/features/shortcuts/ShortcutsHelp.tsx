import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog';
import { SHORTCUT_ROUTES } from './keyboard-shortcuts';

/** A single shortcut row: one or more `<kbd>` chips plus a description. */
function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <li className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-text">{description}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((key, index) => (
          <kbd
            key={`${key}-${index}`}
            className="rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] font-medium text-text-muted"
          >
            {key}
          </kbd>
        ))}
      </span>
    </li>
  );
}

/**
 * `?`-triggered overlay listing every keyboard shortcut: the `g <letter>` navigation combos
 * (kept in sync with `keyboard-shortcuts.ts`'s single source of truth) plus the general shortcuts
 * (help, command palette, close). Reuses the shared dialog primitive, so it's focus-trapped and
 * Esc/backdrop-dismissible with focus restored to the opener for free.
 */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent aria-modal="true" className="max-w-sm">
        <DialogTitle>Keyboard shortcuts</DialogTitle>

        <div className="mt-4">
          <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted/80">
            Navigation
          </p>
          <ul>
            {SHORTCUT_ROUTES.map((route) => (
              <ShortcutRow key={route.letter} keys={['g', route.letter]} description={route.label} />
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted/80">
            General
          </p>
          <ul>
            <ShortcutRow keys={['?']} description="Show this help" />
            <ShortcutRow keys={['⌘K']} description="Open command palette" />
            <ShortcutRow keys={['/']} description="Open command palette" />
            <ShortcutRow keys={['Esc']} description="Close dialog" />
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
