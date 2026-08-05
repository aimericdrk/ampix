import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { EmptyState } from '../../../components/ui/empty-state';

/**
 * Stands in for a MyRevenueCat page whose data surface isn't built yet. Deliberately not a 404:
 * the nav lists the whole RevenueCat IA up front, so every entry must resolve to something that
 * explains itself rather than looking broken.
 */
export function RcPlaceholderPage({ title, description }: { title: string; description: string }) {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };

  return (
    <PageShell
      projectId={projectId}
      title={title}
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: title }]}
    >
      <EmptyState title={`${title} is not built yet`} description={description} />
    </PageShell>
  );
}
