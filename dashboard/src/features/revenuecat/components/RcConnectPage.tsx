import { PageShell } from '../../../components/layout/PageShell';
import { EmptyState } from '../../../components/ui/empty-state';
import { IntegrationsSection } from '../../projects/components/IntegrationsSection';
import { useProjectRole, useProjects } from '../../projects/api';

/**
 * MyRevenueCat's landing page for a project that hasn't connected RevenueCat. The tool's rail
 * button is always visible, so this is what an unconnected project sees instead of empty charts —
 * it doubles as the upsell and the setup path.
 *
 * Reuses `IntegrationsSection` (which renders the connect form off its own `useRcStatus`) so there
 * is exactly one connect flow, shared with project settings and `RcSettingsPage`.
 *
 * Mirrors `RcSettingsPage`'s `project && isAdmin` gate: nothing renders — not even the "ask an
 * admin" empty state — until `useProjects()` has actually resolved, so a still-loading role is
 * never mistaken for a confirmed non-admin. (`RcOverviewPage` and `RcConversionPage`, this page's
 * callers, apply the same discipline one level up before deciding to render this page at all.)
 *
 * Takes `projectId` as a prop rather than reading it off `useParams` — every RC page that renders
 * this needs to work, and pinning a route here would throw whenever it mounted under any other one.
 */
export function RcConnectPage({ projectId }: { projectId: string }) {
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const role = useProjectRole(project?.id);
  const isAdmin = role === 'admin' || role === 'owner';

  return (
    <PageShell
      projectId={projectId}
      title="Connect RevenueCat"
      description="Bring your subscription data in to see MRR, churn, and customers."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Connect' }]}
    >
      {project && isAdmin && <IntegrationsSection projectId={projectId} />}
      {project && !isAdmin && (
        <EmptyState
          title="Ask an admin to connect RevenueCat"
          description="Only project admins can connect integrations. Once RevenueCat is connected, subscription analytics appear here."
        />
      )}
    </PageShell>
  );
}
