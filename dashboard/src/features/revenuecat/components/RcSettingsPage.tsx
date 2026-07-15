import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { EmptyState } from '../../../components/ui/empty-state';
import { IntegrationsSection } from '../../projects/components/IntegrationsSection';
import { useProjectRole, useProjects } from '../../projects/api';

/**
 * MyRevenueCat → Integration settings. Its own route rather than a link into project settings, so
 * configuring the tool doesn't navigate you out of it. Reuses `IntegrationsSection` — which already
 * switches between the connect form and the connected panel off `useRcStatus` — so there is exactly
 * one RevenueCat connect/manage surface, rendered in two places.
 */
export function RcSettingsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/settings' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const role = useProjectRole(project?.id);
  const isAdmin = role === 'admin' || role === 'owner';

  return (
    <PageShell
      projectId={projectId}
      title="Integration settings"
      description="Connect and manage the RevenueCat integration for this project."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Integration settings' }]}
    >
      {/* Mirrors ProjectDetailPage's `project && isAdmin` gating: nothing renders — not even the
          "only admins" empty state — until `useProjects()` has actually resolved, so a still-loading
          role is never mistaken for a confirmed non-admin. */}
      {project && isAdmin && <IntegrationsSection projectId={projectId} />}
      {project && !isAdmin && (
        <EmptyState
          title="Only admins can manage integrations"
          description="Ask a project admin to connect or change the RevenueCat integration."
        />
      )}
    </PageShell>
  );
}
