import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { projectGroups } from '../../components/layout/nav-model';

/** How long a lone `g` keypress stays "armed" waiting for the next letter. */
export const G_SEQUENCE_TIMEOUT_MS = 1200;

/**
 * Letters assigned to `g <letter>` navigation sequences, keyed by the nav item's label from
 * `nav-model.ts` (the single source of truth for "what pages exist and where do they link").
 * Only destinations worth a fast keyboard jump get a letter — not every nav item needs one.
 *
 * Note: `r` maps to Retention rather than Reports — Retention is the more frequent destination
 * during exploration; Reports stays reachable via the sidebar and the command palette.
 */
const NAV_SHORTCUT_LETTERS: Record<string, string> = {
  Home: 'h',
  Insights: 'i',
  Funnels: 'f',
  Retention: 'r',
  Users: 'u',
  Dashboards: 'd',
  Revenue: 'v',
};

export interface ShortcutRoute {
  /** The letter that completes the `g <letter>` sequence. */
  letter: string;
  /** Display label, taken straight from `nav-model.ts`. */
  label: string;
  /** Route template (contains `$projectId`), taken straight from `nav-model.ts`. */
  to: string;
}

/**
 * The `g`-prefixed navigation shortcuts, derived from `projectGroups()` so they can never drift
 * from the sidebar/command palette's routes. This is the one place the letter→route map lives;
 * both `useKeyboardShortcuts` (navigation) and `ShortcutsHelp` (display) read from it.
 */
export const SHORTCUT_ROUTES: ShortcutRoute[] = projectGroups()
  .flatMap((group) => group.items)
  .flatMap((item) => {
    const letter = NAV_SHORTCUT_LETTERS[item.label];
    return letter ? [{ letter, label: item.label, to: item.to }] : [];
  });

const SHORTCUT_ROUTES_BY_LETTER: Record<string, ShortcutRoute> = Object.fromEntries(
  SHORTCUT_ROUTES.map((route) => [route.letter, route]),
);

/** True when the event target is a place the user is typing text into. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}

export interface UseKeyboardShortcutsOptions {
  /** Needed to resolve `$projectId` in shortcut route templates; `g <letter>` no-ops without it. */
  projectId?: string;
  /** Called when `?` (Shift+/) is pressed. */
  onShowHelp: () => void;
  /**
   * Suspends the whole listener (both the `g` sequence and `?`) — e.g. while the help overlay
   * itself is open, so a stray keypress can't fire a surprise navigation behind it. `⌘K` and `/`
   * are never handled here at all: the command palette already owns them.
   */
  disabled?: boolean;
}

/**
 * Global `g <letter>` navigation shortcuts + `?` help overlay trigger. Mounted once in
 * `AppLayout`, which has both `projectId` and router access. Ignores keystrokes while the user is
 * typing in a field, or while a modifier (Ctrl/Cmd/Alt) is held, so it never hijacks normal typing
 * or the command palette's own `⌘K` / `/` bindings.
 */
export function useKeyboardShortcuts({
  projectId,
  onShowHelp,
  disabled,
}: UseKeyboardShortcutsOptions): void {
  const navigate = useNavigate();
  const armedRef = useRef(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function disarm() {
      armedRef.current = false;
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (disabled) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === '?') {
        disarm();
        onShowHelp();
        return;
      }

      if (armedRef.current) {
        disarm();
        const route = SHORTCUT_ROUTES_BY_LETTER[event.key.toLowerCase()];
        if (route && projectId) {
          event.preventDefault();
          // `to` is a shared nav-model route template, so it can't be a route-literal for
          // TanStack Router's typed `navigate` overloads — same narrow escape hatch the
          // command palette uses for its dynamic destinations.
          void navigate({ to: route.to, params: { projectId } } as unknown as Parameters<
            typeof navigate
          >[0]);
        }
        return;
      }

      if (event.key.toLowerCase() === 'g') {
        armedRef.current = true;
        timeoutRef.current = window.setTimeout(disarm, G_SEQUENCE_TIMEOUT_MS);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      disarm();
    };
  }, [navigate, projectId, onShowHelp, disabled]);
}
