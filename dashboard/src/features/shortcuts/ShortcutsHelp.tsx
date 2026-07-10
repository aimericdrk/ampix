import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog';
import { Kbd } from '../../components/ui/kbd';
import { SHORTCUT_ROUTES } from './keyboard-shortcuts';

/** A single shortcut row: one or more `Kbd` chips plus a description. */
function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <li className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-text">{description}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((key, index) => (
          <Kbd key={`${key}-${index}`}>{key}</Kbd>
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
          <p className="pb-1 text-xs uppercase tracking-wide text-text-muted">
            Navigation
          </p>
          <ul>
            {SHORTCUT_ROUTES.map((route) => (
              <ShortcutRow key={route.letter} keys={['g', route.letter]} description={route.label} />
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <p className="pb-1 text-xs uppercase tracking-wide text-text-muted">
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
