import type { IconName } from './NavIcon';

export interface NavItem {
  label: string;
  to: string;
  icon: IconName;
  /** Match only the exact path (so a parent link isn't active on its children). */
  exact?: boolean;
}

/** One of the fixed section hues (`data-accent` re-points `--accent` for everything the group wraps). */
export type NavAccent = 'violet' | 'cyan' | 'lime' | 'amber' | 'pink';

export interface NavGroup {
  heading?: string;
  items: NavItem[];
  accent?: NavAccent;
}

/**
 * The grouped project information architecture — one calm, scannable list instead of a tab strip.
 * Single source of truth for "what pages exist and where do they link": consumed by the sidebar
 * (`AppLayout`) and the command palette's "Pages" section (`features/command-palette`), so the two
 * never drift apart.
 */
export function projectGroups(): NavGroup[] {
  const p = (path: string) => `/projects/$projectId${path}`;
  return [
    {
      items: [{ label: 'Home', to: p('/home'), icon: 'home' }],
      accent: 'violet',
    },
    {
      heading: 'Explore',
      accent: 'cyan',
      items: [
        { label: 'Insights', to: p('/insights'), icon: 'insights' },
        { label: 'Funnels', to: p('/funnels'), icon: 'funnel' },
        { label: 'Retention', to: p('/retention'), icon: 'retention' },
        // "Paths" is the interactive user-path map + Mermaid view (screen-paths, §19).
        { label: 'Paths', to: p('/paths'), icon: 'paths' },
        { label: 'Heatmap', to: p('/heatmap'), icon: 'heatmap' },
        { label: 'Revenue', to: p('/revenue'), icon: 'revenue' },
        { label: 'Distributions', to: p('/distributions'), icon: 'distributions' },
        { label: 'Properties', to: p('/properties'), icon: 'properties' },
        { label: 'Events', to: p('/events'), icon: 'events' },
      ],
    },
    {
      heading: 'Audience',
      accent: 'pink',
      items: [
        { label: 'Cohorts', to: p('/cohorts'), icon: 'cohorts' },
        { label: 'Users', to: p('/users'), icon: 'users' },
        { label: 'Sessions', to: p('/sessions'), icon: 'sessions' },
        { label: 'Live', to: p('/live'), icon: 'live' },
      ],
    },
    {
      heading: 'Saved',
      accent: 'amber',
      items: [
        { label: 'Dashboards', to: p('/dashboards'), icon: 'dashboards' },
        { label: 'Reports', to: p('/reports'), icon: 'reports' },
        { label: 'Templates', to: p('/templates'), icon: 'templates' },
      ],
    },
    {
      items: [{ label: 'Project settings', to: p(''), icon: 'settings', exact: true }],
      accent: 'lime',
    },
  ];
}
