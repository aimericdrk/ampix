import { useParams } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';

export function ProjectPlaceholderPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId' });
  return (
    <section>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Analytics coming soon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-muted">
            Live feed, insights, funnels, retention, flows, users, cohorts and dashboards for
            project <code className="rounded bg-bg px-1">{projectId}</code> arrive in later
            milestones (design spec §13).
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
