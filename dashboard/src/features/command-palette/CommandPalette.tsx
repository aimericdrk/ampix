import { useNavigate } from '@tanstack/react-router';
import { IconSparkle } from '../../components/ui/icons';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog';
import { IconSearch } from '../../components/ui/icons';
import { useToast } from '../../components/ui/toast';
import { projectGroups } from '../../components/layout/nav-model';
import { NavIcon, type IconName } from '../../components/layout/NavIcon';
import { cn } from '../../lib/cn';
import type { UserListItem } from '../../lib/api/types';
import { useCohorts, useDashboards, useReports, useUsersList } from '../analytics/api';
import { useProjects } from '../projects/api';
import { useFavorites } from '../favorites/favorites';
import type { FavItemType } from '../favorites/favorites';
import { useRecents } from '../favorites/recents';
import { favItemRoute } from '../favorites/routes';

/** Debounce delay (ms) before a typed query fires the `/users` search request. */
const USER_SEARCH_DEBOUNCE_MS = 200;
/** Cap the user-search section so a broad query doesn't flood the palette. */
const MAX_USER_RESULTS = 5;

/** A small stroked "link" glyph for palette actions that aren't a `NavIcon`-backed page/entity. */
function IconLink() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.5-1.5" />
    </svg>
  );
}

interface PaletteItem {
  key: string;
  /** Omitted for actions with no `NavIcon` entry (e.g. "Copy link") — renders {@link IconLink} instead. */
  icon?: IconName;
  /** Overrides both `icon` and the {@link IconLink} fallback for one-off action glyphs. */
  customIcon?: ReactNode;
  label: string;
  sublabel?: string;
  onSelect: () => void;
}

interface PaletteGroup {
  heading: string;
  items: PaletteItem[];
}

/** Case-insensitive substring match; an empty query matches everything (mirrors `filterOptions`). */
function matchesQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle.length === 0 || text.toLowerCase().includes(needle);
}

/** Maps a `FavItem`'s entity type to its `NavIcon`, reusing the same glyphs as the Reports/
 * Dashboards/Cohorts/Users palette sections below. */
const ICON_FOR_FAV_TYPE: Record<FavItemType, IconName> = {
  report: 'reports',
  dashboard: 'dashboards',
  user: 'users',
  cohort: 'cohorts',
};

/** Settles `value` after `delayMs` of no changes — used to throttle the network-backed user search. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Fetches the user search results for the command palette. A separate component (rather than
 * calling `useUsersList` directly in {@link CommandPalette}) so the query only ever mounts — and
 * only ever fires — once there is a non-empty debounced query; it unmounts (and the query is
 * dropped) as soon as the box empties again.
 */
function UsersResultsLoader({
  projectId,
  query,
  onResults,
}: {
  projectId: string;
  query: string;
  onResults: (users: UserListItem[]) => void;
}) {
  const { data } = useUsersList(projectId, query);
  const users = data?.pages[0]?.users ?? [];

  // `onResults` is a state setter from the parent (stable identity) — only re-run on new data.
  useEffect(() => {
    onResults(users.slice(0, MAX_USER_RESULTS));
  }, [data]);

  return null;
}

/**
 * The ⌘K / Ctrl+K command palette: a searchable jump-to-anything overlay across pages, saved
 * reports/dashboards/cohorts, users, and projects. Mounted once per project scope in `AppLayout`,
 * and reused for the small "⌘K" trigger button so there is a single source of truth for open state.
 */
export function CommandPalette({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [userResults, setUserResults] = useState<UserListItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const debouncedQuery = useDebouncedValue(query, USER_SEARCH_DEBOUNCE_MS);
  const hasQuery = debouncedQuery.trim().length > 0;

  const { data: reportsData } = useReports(projectId);
  const { data: dashboardsData } = useDashboards(projectId);
  const { data: cohortsData } = useCohorts(projectId);
  const { data: projectsData } = useProjects();
  const favorites = useFavorites(projectId);
  const recents = useRecents(projectId);

  // Dropping stale rows the instant the query empties keeps a since-cleared search from lingering.
  useEffect(() => {
    if (!hasQuery) setUserResults([]);
  }, [hasQuery]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  // `to` is assembled dynamically (shared nav-model paths, entity ids) so it can never be a
  // route-literal for TanStack Router's typed `navigate` overloads — this is the one narrow,
  // commented escape hatch for that, same as any dynamic-destination router call would need.
  const goTo = (to: string, params: Record<string, string>, search?: Record<string, unknown>) => {
    void navigate({ to, params, search } as unknown as Parameters<typeof navigate>[0]);
    close();
  };

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Global ⌘K / Ctrl+K (and, when not typing elsewhere, "/") shortcut — cleaned up on unmount.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === '/' && !open) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
        if (!isTyping) {
          event.preventDefault();
          setOpen(true);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Focus the search box every time the palette opens (Radix traps focus inside; this just
  // guarantees it lands on the input rather than the dialog shell).
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Favorites & Recents (feat-13 §3): only shown on an empty query, ahead of Pages, so starred and
  // last-visited entities are one keystroke (⌘K, Enter) away.
  const isEmptyQuery = query.trim().length === 0;

  const favoriteItems: PaletteItem[] = isEmptyQuery
    ? favorites.list.map((item) => {
        const route = favItemRoute(item, projectId);
        return {
          key: `favorite-${item.type}-${item.id}`,
          icon: ICON_FOR_FAV_TYPE[item.type],
          label: item.name,
          onSelect: () => goTo(route.to, route.params),
        };
      })
    : [];

  const recentItems: PaletteItem[] = isEmptyQuery
    ? recents.list.map((item) => {
        const route = favItemRoute(item, projectId);
        return {
          key: `recent-${item.type}-${item.id}`,
          icon: ICON_FOR_FAV_TYPE[item.type],
          label: item.name,
          onSelect: () => goTo(route.to, route.params),
        };
      })
    : [];

  const pageItems: PaletteItem[] = projectGroups()
    .flatMap((group) => group.items)
    .filter((item) => matchesQuery(item.label, query))
    .map((item) => ({
      key: `page-${item.to}`,
      icon: item.icon,
      label: item.label,
      onSelect: () => goTo(item.to, { projectId }),
    }));

  const reportItems: PaletteItem[] = (reportsData?.reports ?? [])
    .filter((report) => matchesQuery(report.name, query))
    .map((report) => ({
      key: `report-${report.id}`,
      icon: 'reports',
      label: report.name,
      onSelect: () => goTo('/projects/$projectId/reports/$reportId', { projectId, reportId: report.id }),
    }));

  const dashboardItems: PaletteItem[] = (dashboardsData?.dashboards ?? [])
    .filter((dashboard) => matchesQuery(dashboard.name, query))
    .map((dashboard) => ({
      key: `dashboard-${dashboard.id}`,
      icon: 'dashboards',
      label: dashboard.name,
      onSelect: () =>
        goTo('/projects/$projectId/dashboards/$dashboardId', { projectId, dashboardId: dashboard.id }),
    }));

  const cohortItems: PaletteItem[] = (cohortsData?.cohorts ?? [])
    .filter((cohort) => matchesQuery(cohort.name, query))
    .map((cohort) => ({
      key: `cohort-${cohort.id}`,
      icon: 'cohorts',
      // Cohorts have no standalone detail route today — they're edited inline on the list page —
      // so the palette lands on the Cohorts page rather than a dead link.
      onSelect: () => goTo('/projects/$projectId/cohorts', { projectId }),
      label: cohort.name,
    }));

  const userItems: PaletteItem[] = userResults.map((user) => ({
    key: `user-${user.distinct_id}`,
    icon: 'users',
    label: user.name ?? user.distinct_id,
    sublabel: user.name ? (user.email ?? user.distinct_id) : undefined,
    onSelect: () =>
      goTo('/projects/$projectId/users/$distinctId', { projectId, distinctId: user.distinct_id }),
  }));

  const projectItems: PaletteItem[] = (projectsData?.projects ?? [])
    .filter((project) => matchesQuery(project.name, query))
    .map((project) => ({
      key: `project-${project.id}`,
      icon: 'projects',
      label: project.name,
      sublabel: project.org_name,
      onSelect: () => goTo('/projects/$projectId/home', { projectId: project.id }),
    }));

  // Shareable Analysis URLs (feat-01 §3.3): discoverable alongside each page's own "Copy link"
  // button. `window.location.href` already carries the current view's `?s=` state, so this needs
  // no page-specific wiring — it works for any route the palette is opened from.
  const actionItems: PaletteItem[] = [
    {
      key: 'action-copy-link',
      label: 'Copy link to this view',
      onSelect: () => {
        if (navigator.clipboard) {
          navigator.clipboard
            .writeText(window.location.href)
            .then(() => toast({ title: 'Link copied' }))
            .catch(() => {
              // Best-effort only — clipboard access can be denied/unavailable; no error surfaced.
            });
        }
        close();
      },
    },
    {
      // "Ask your data" (feat-17 §3.2): navigates to Insights carrying the one-shot `ask` search
      // flag, which `InsightsPage` reads to focus the `AskBar` on arrival (then strips the flag).
      key: 'action-ask-data',
      label: 'Ask your data',
      customIcon: <IconSparkle size={16} />,
      onSelect: () => goTo('/projects/$projectId/insights', { projectId }, { ask: true }),
    },
  ].filter((item) => matchesQuery(item.label, query));

  const groups: PaletteGroup[] = [
    { heading: 'Favorites', items: favoriteItems },
    { heading: 'Recents', items: recentItems },
    { heading: 'Pages', items: pageItems },
    { heading: 'Actions', items: actionItems },
    { heading: 'Reports', items: reportItems },
    { heading: 'Dashboards', items: dashboardItems },
    { heading: 'Cohorts', items: cohortItems },
    { heading: 'Users', items: userItems },
    { heading: 'Projects', items: projectItems },
  ].filter((group) => group.items.length > 0);

  const flatItems = groups.flatMap((group) => group.items);
  const clampedIndex = Math.min(activeIndex, Math.max(flatItems.length - 1, 0));
  const activeItem = flatItems[clampedIndex];
  const optionId = (index: number) => `${listId}-opt-${index}`;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, flatItems.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activeItem?.onSelect();
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Open command palette"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-border/40 hover:text-text"
      >
        <IconSearch size={14} />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>

      {hasQuery && (
        <UsersResultsLoader
          projectId={projectId}
          query={debouncedQuery}
          onResults={setUserResults}
        />
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else close();
        }}
      >
        <DialogContent className="top-24 max-w-xl -translate-y-0 gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <IconSearch className="shrink-0 text-text-muted" size={16} />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-label="Search pages, reports, dashboards, cohorts, users, and projects"
              aria-activedescendant={activeItem ? optionId(clampedIndex) : undefined}
              autoComplete="off"
              className="h-9 w-full border-0 bg-transparent text-sm text-text placeholder:text-text-muted focus:outline-none"
              placeholder="Search pages, reports, dashboards, cohorts, users, projects…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <ul id={listId} role="listbox" aria-label="Results" className="max-h-96 overflow-y-auto p-2">
            {flatItems.length === 0 ? (
              <li className="px-2 py-6 text-center text-sm text-text-muted">
                No matches{query.trim() ? ` for "${query.trim()}"` : ''}.
              </li>
            ) : (
              groups.map((group) => (
                <li key={group.heading} className="mb-2 last:mb-0">
                  <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted/80">
                    {group.heading}
                  </p>
                  <ul>
                    {group.items.map((item) => {
                      const index = flatItems.indexOf(item);
                      return (
                        <li
                          key={item.key}
                          id={optionId(index)}
                          role="option"
                          aria-selected={index === clampedIndex}
                          onPointerEnter={() => setActiveIndex(index)}
                          onClick={() => item.onSelect()}
                          className={cn(
                            'flex cursor-pointer items-center gap-2.5 truncate rounded px-2 py-1.5 text-sm',
                            index === clampedIndex
                              ? 'bg-accent text-accent-fg'
                              : 'text-text hover:bg-border/40',
                          )}
                        >
                          {item.customIcon ?? (item.icon ? <NavIcon name={item.icon} /> : <IconLink />)}
                          <span className="truncate">{item.label}</span>
                          {item.sublabel && (
                            <span className="ml-auto shrink-0 truncate text-xs text-text-muted">
                              {item.sublabel}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
