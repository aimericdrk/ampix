import { Link } from '@tanstack/react-router';
import { m } from 'motion/react';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { CreditCard, LineChart, type LucideIcon } from 'lucide-react';
import { PageShell } from './PageShell';
import { Reveal } from '../ui/reveal';
import { cn } from '../../lib/cn';
import { springTransition, useReducedMotion } from '../../lib/motion';

/** Which of the two settings areas a page belongs to — the top-level switcher's two states. */
export type SettingsScope = 'ampix' | 'revenuecat';

/** One titled block of settings: a rail entry and a full-width panel, from a single description. */
export interface SettingsPanel {
  /** DOM id, also the rail anchor target. */
  id: string;
  /** Rail label; also the panel heading unless `title` overrides it. */
  label: string;
  icon: LucideIcon;
  title?: string;
  description?: ReactNode;
  /** Right-aligned controls in the panel header (e.g. a "New app" button). */
  actions?: ReactNode;
  /** `danger` tints the panel border — used by the destructive block. */
  tone?: 'default' | 'danger';
  testId?: string;
  content: ReactNode;
}

const SCOPES: Array<{
  id: SettingsScope;
  to: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}> = [
  {
    id: 'ampix',
    to: '/projects/$projectId',
    label: 'MyAmpix',
    hint: 'Project, access, SDK tokens & data',
    icon: LineChart,
  },
  {
    id: 'revenuecat',
    to: '/projects/$projectId/rc/settings',
    label: 'MyRevenueCat',
    hint: 'Apps, store credentials & purchase keys',
    icon: CreditCard,
  },
];

const SCOPE_LABEL: Record<SettingsScope, string> = {
  ampix: 'MyAmpix',
  revenuecat: 'MyRevenueCat',
};

/** How far below the viewport top a panel counts as "the one you're reading" (px). */
const SPY_OFFSET = 140;

/**
 * Both settings areas share one page frame: a top-level MyAmpix / MyRevenueCat switcher, a sticky
 * section rail, and one full-width column of panels. Panels are described as data rather than
 * composed as children so the rail and the content can never drift apart — a caller that hides a
 * panel behind a role check drops one array entry and both sides follow.
 */
export function SettingsLayout({
  projectId,
  projectName,
  scope,
  panels,
}: {
  projectId: string;
  projectName: string;
  scope: SettingsScope;
  panels: SettingsPanel[];
}) {
  return (
    <PageShell
      title={projectName}
      description="Settings"
      breadcrumbs={[
        { label: 'Projects', to: '/projects' },
        { label: projectName },
        { label: `${SCOPE_LABEL[scope]} settings` },
      ]}
    >
      <div className="flex flex-col gap-6">
        <ScopeSwitcher projectId={projectId} scope={scope} />
        {/* The rail only earns its column once there is more than one panel to jump between. */}
        <div
          className={cn(
            'grid gap-6',
            panels.length > 1 && 'lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-8',
          )}
        >
          {panels.length > 1 && <SectionRail panels={panels} />}
          <div className="flex min-w-0 flex-col gap-5">
            {panels.map((panel, index) => (
              <Reveal key={panel.id} index={index}>
                <SettingsPanelCard panel={panel} />
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

/** The top-level switch between the two products' settings. Real links, not tabs: each area is its
 *  own route, so the sidebar's active tool stays in step with what the page is showing. */
function ScopeSwitcher({ projectId, scope }: { projectId: string; scope: SettingsScope }) {
  const reducedMotion = useReducedMotion();

  return (
    <nav
      aria-label="Settings area"
      className="grid gap-1 rounded-xl border border-border bg-surface p-1 shadow-sm sm:grid-cols-2"
    >
      {SCOPES.map((entry) => {
        const isActive = entry.id === scope;
        const Icon = entry.icon;
        return (
          <Link
            key={entry.id}
            to={entry.to}
            params={{ projectId }}
            // `Link` unions its own `aria-current` into ours rather than overriding it, and its
            // default match is a prefix one — so without `exact`, MyAmpix (`/projects/$projectId`)
            // would also read as current while its descendant `/rc/settings` is open.
            activeOptions={{ exact: true }}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-3 rounded-lg px-4 py-3 transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              isActive ? 'text-text' : 'text-text-muted hover:bg-surface-raised hover:text-text',
              // Under reduced motion the sliding highlight is not rendered, so the active pill
              // needs a static background of its own.
              isActive && reducedMotion && 'bg-accent-soft ring-1 ring-inset ring-accent/30',
            )}
          >
            {isActive && !reducedMotion && (
              <m.span
                aria-hidden="true"
                layoutId="settings-scope-highlight"
                transition={springTransition}
                className="absolute inset-0 rounded-lg bg-accent-soft ring-1 ring-inset ring-accent/30"
              />
            )}
            <span
              className={cn(
                'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
                isActive ? 'bg-accent text-accent-fg' : 'bg-surface-raised',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="relative min-w-0">
              <span className={cn('block text-sm font-semibold', isActive && 'text-accent')}>
                {entry.label}
              </span>
              <span className="block truncate text-xs text-text-muted">{entry.hint}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Sticky in-page nav: a column beside the panels from `lg` up, a horizontal strip below it. */
function SectionRail({ panels }: { panels: SettingsPanel[] }) {
  const activeId = useActivePanel(panels.map((panel) => panel.id));

  const handleJump = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return; // Let the browser fall back to the plain anchor jump.
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Move the keyboard caret with the viewport, so tabbing on continues inside the panel that
    // was just jumped to rather than back at the rail.
    target.focus({ preventScroll: true });
    window.history.replaceState(null, '', `#${id}`);
  };

  return (
    // `min-w-0`: as a grid item the rail's automatic minimum size is its min-content width — the
    // whole horizontal strip below `lg` — which would widen the page rather than scroll inside it.
    <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-8 lg:self-start">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0">
        {panels.map((panel) => {
          const isActive = panel.id === activeId;
          const Icon = panel.icon;
          return (
            <li key={panel.id}>
              <a
                href={`#${panel.id}`}
                onClick={(event) => handleJump(event, panel.id)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  isActive
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-text-muted hover:bg-surface-raised hover:text-text',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {panel.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Scroll-spy over the rendered panels: the lowest panel whose top has passed `SPY_OFFSET` is the
 * one being read. A plain scroll listener rather than an IntersectionObserver — panels are taller
 * than the viewport, so intersection ratios say nothing useful about which one you are looking at.
 */
function useActivePanel(ids: string[]): string | undefined {
  const key = ids.join('|');
  const [activeId, setActiveId] = useState<string | undefined>(ids[0]);

  useEffect(() => {
    const panelIds = key ? key.split('|') : [];
    const sync = () => {
      let current = panelIds[0];
      for (const id of panelIds) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= SPY_OFFSET) current = id;
      }
      setActiveId(current);
    };
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [key]);

  return activeId;
}

function SettingsPanelCard({ panel }: { panel: SettingsPanel }) {
  return (
    <section
      id={panel.id}
      // Focusable so the rail can park the caret here, but not a tab stop of its own.
      tabIndex={-1}
      aria-labelledby={`${panel.id}-heading`}
      data-testid={panel.testId}
      className={cn(
        'scroll-mt-24 overflow-hidden rounded-xl border bg-surface shadow-sm focus:outline-none',
        panel.tone === 'danger' ? 'border-danger/40' : 'border-border',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-surface-raised/40 px-6 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              panel.tone === 'danger'
                ? 'bg-danger-soft text-danger'
                : 'bg-surface-raised text-text-muted',
            )}
          >
            <panel.icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id={`${panel.id}-heading`} className="text-base font-semibold">
              {panel.title ?? panel.label}
            </h2>
            {panel.description && (
              <p className="mt-0.5 max-w-3xl text-sm text-text-muted">{panel.description}</p>
            )}
          </div>
        </div>
        {panel.actions && <div className="flex shrink-0 items-center gap-2">{panel.actions}</div>}
      </header>
      <div className="px-6 py-5">{panel.content}</div>
    </section>
  );
}
