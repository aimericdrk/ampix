export type IconName =
  | 'home'
  | 'insights'
  | 'funnel'
  | 'retention'
  | 'paths'
  | 'heatmap'
  | 'cohorts'
  | 'users'
  | 'sessions'
  | 'live'
  | 'dashboards'
  | 'reports'
  | 'templates'
  | 'projects'
  | 'org'
  | 'account'
  | 'settings';

/** Inline stroked SVG paths — a lightweight icon set (no icon dependency). 16px, currentColor. */
const PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  insights: 'M4 4v16h16M8 15l3-4 3 2 4-6',
  funnel: 'M3 4h18l-7 8v7l-4-2v-5z',
  retention: 'M4 12a8 8 0 0 1 13.7-5.6L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.6L4 16M4 20v-4h4',
  paths: 'M6 4v6a4 4 0 0 0 4 4h4M18 10l3 3-3 3M6 4h.01M6 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  heatmap: 'M4 4h16v16H4zM4 9h16M4 14h16M9 4v16M14 4v16',
  cohorts: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M18 20a6 6 0 0 0-4-5.7',
  users: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
  sessions: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  live: 'M4 12h3l2 6 4-14 2 8 2-2h3',
  dashboards: 'M4 4h7v6H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 13h7v7H4z',
  reports: 'M6 3h9l5 5v13H6zM15 3v5h5M9 13h7M9 17h7',
  templates: 'M4 5h16v4H4zM4 12h7v8H4zM14 12h6v8h-6z',
  projects: 'M3 7l2-3h5l2 3h7v13H3zM3 7h18',
  org: 'M3 21h18M5 21V7l7-4 7 4v14M10 21v-4h4v4M9 9h.02M15 9h.02M9 13h.02M15 13h.02',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 2h-4l-.4 2.4a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L4.1 11a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.4h4l.4-2.4a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z',
};

export function NavIcon({ name }: { name: IconName }) {
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
      <path d={PATHS[name]} />
    </svg>
  );
}
