import { Link, useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { useCreateDashboard, useDashboards } from '../api';
import { PageShell } from '../../../components/layout/PageShell';

export function DashboardsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/dashboards' });
  const dashboards = useDashboards(projectId);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <PageShell
      projectId={projectId}
      title="Dashboards"
      description="Pin charts together into shareable boards."
      breadcrumbs={[{ label: 'Saved' }, { label: 'Dashboards' }]}
      actions={
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>New dashboard</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>New dashboard</DialogTitle>
            <DialogDescription>Creates an empty board you can add report tiles to.</DialogDescription>
            <NewDashboardForm projectId={projectId} onCreated={() => setDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      }
    >
      {dashboards.isPending && <p role="status">Loading dashboards…</p>}
      {dashboards.error && (
        <p role="alert" className="text-danger">
          {dashboards.error instanceof ApiError
            ? dashboards.error.problem.title
            : 'Failed to load dashboards'}
        </p>
      )}

      {dashboards.data && dashboards.data.dashboards.length === 0 && (
        <p className="text-text-muted">No dashboards yet.</p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {dashboards.data?.dashboards.map((dashboard) => (
          <Link
            key={dashboard.id}
            to="/projects/$projectId/dashboards/$dashboardId"
            params={{ projectId, dashboardId: dashboard.id }}
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Card className="h-full transition-colors hover:border-accent">
              <CardHeader>
                <CardTitle>{dashboard.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-text-muted">
                  {dashboard.tile_count} {dashboard.tile_count === 1 ? 'tile' : 'tiles'}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}

function NewDashboardForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const createDashboard = useCreateDashboard(projectId);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    createDashboard.mutate(
      { name: name.trim() },
      {
        onSuccess: () => {
          toast({ title: 'Dashboard created' });
          setName('');
          onCreated();
        },
        onError: (error) =>
          toast({
            title: 'Could not create dashboard',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
      <div>
        <label htmlFor="new-dashboard-name" className="mb-1 block text-sm font-medium">
          Dashboard name
        </label>
        <Input id="new-dashboard-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={createDashboard.isPending || !name.trim()}>
        {createDashboard.isPending ? 'Creating…' : 'Create dashboard'}
      </Button>
    </form>
  );
}
