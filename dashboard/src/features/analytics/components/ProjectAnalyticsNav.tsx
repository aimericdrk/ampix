import { Link } from '@tanstack/react-router';

const TABS = [
  { to: '/projects/$projectId', label: 'Overview', exact: true },
  { to: '/projects/$projectId/insights', label: 'Insights', exact: false },
  { to: '/projects/$projectId/live', label: 'Live', exact: false },
  { to: '/projects/$projectId/users', label: 'Users', exact: false },
  { to: '/projects/$projectId/sessions', label: 'Sessions', exact: false },
] as const;

/** Project-scoped analytics tab nav — linked from the project detail page and every analytics page. */
export function ProjectAnalyticsNav({ projectId }: { projectId: string }) {
  return (
    <nav aria-label="Project analytics" className="flex gap-1 border-b border-border pb-px">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          params={{ projectId }}
          activeOptions={{ exact: tab.exact }}
          className="rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-text-muted hover:text-text [&.active]:border-accent [&.active]:font-medium [&.active]:text-text"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
