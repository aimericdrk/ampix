import { useParams, useRouter } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  Database,
  Inbox,
  KeyRound,
  Plug,
  ScrollText,
  Settings2,
  Users,
  Wallet,
} from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { CollapsibleSection } from '../../../components/ui/CollapsibleSection';
import { DataTable } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/empty-state';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import {
  SettingsLayout,
  type SettingsPanel,
} from '../../../components/layout/SettingsLayout';
import { ApiError } from '../../../lib/api/problem';
import { useEventSummary, useProjectRole, useProjects, useUpdateProject } from '../api';
import { IntegrationsSection } from './IntegrationsSection';
import { ProjectMembersSection } from './ProjectMembersSection';
import { DangerZonePanel } from './settings/DangerZonePanel';
import { ServerKeysPanel } from './settings/ServerKeysPanel';
import { SettingRow, SettingRows } from './settings/panel-kit';
import { TokensPanel } from './settings/TokensPanel';

/**
 * MyAmpix half of the project settings screen (sidebar "Project settings" → /projects/$projectId).
 * The MyRevenueCat half lives at `/rc/settings` and wears the same `SettingsLayout` frame — the
 * scope switcher at the top of that frame moves between the two.
 *
 * Read-only info (ingest token, data, facts) is visible to every member; mutations (rename, token
 * create/rotate/revoke) are gated behind the caller's project role being admin+; deleting the
 * project is owner-only (per-project-roles). A gated-out panel is simply left out of the array, so
 * the section rail never advertises a panel that is not rendered.
 */
export function ProjectDetailPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId' });
  const router = useRouter();
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const role = useProjectRole(project?.id);
  const isAdmin = role === 'admin' || role === 'owner';
  const isOwner = role === 'owner';

  const panels: SettingsPanel[] = [];

  if (project && isAdmin) {
    panels.push({
      id: 'general',
      label: 'General',
      icon: Settings2,
      description: 'Rename the project or change its reporting timezone.',
      content: (
        <RenameProjectForm
          projectId={project.id}
          currentName={project.name}
          currentTimezone={project.timezone}
        />
      ),
    });
  }

  if (project) {
    panels.push({
      id: 'members',
      label: 'Members',
      icon: Users,
      description: 'Who has access to this project, and at what role.',
      content: <ProjectMembersSection projectId={project.id} orgId={project.org_id} />,
    });
    panels.push({
      id: 'sdk-tokens',
      label: 'SDK tokens',
      icon: KeyRound,
      description: (
        <>
          Tokens your apps send events with. Each one is either a <strong>client</strong> token
          (ships inside your app, treat as public) or a <strong>server</strong> token (stays on your
          backend) — every event it sends is tagged with that source.
        </>
      ),
      content: (
        <TokensPanel
          projectId={project.id}
          ingestToken={project.ingest_token}
          isAdmin={isAdmin}
        />
      ),
    });
  }

  if (project && isAdmin) {
    panels.push({
      id: 'server-keys',
      label: 'Server keys',
      icon: Wallet,
      title: 'Server keys (purchases)',
      description:
        'Keys your own backend uses to call the purchase API. Keep them on your server — never ship one in an app.',
      content: <ServerKeysPanel projectId={project.id} />,
    });
  }

  panels.push({
    id: 'sdk-log-level',
    label: 'SDK log level',
    icon: ScrollText,
    description: 'How much the MyAmpix SDK logs in your app.',
    content: <LogLevelPanel />,
  });

  panels.push({
    id: 'data',
    label: 'Data',
    icon: Database,
    description: 'Event volume and project facts.',
    content: <DataPanel projectId={projectId} project={project} />,
  });

  if (project && isAdmin) {
    panels.push({
      id: 'integrations',
      label: 'Integrations',
      icon: Plug,
      title: 'RevenueCat',
      description:
        'Subscription events, revenue, and lifecycle analytics from a RevenueCat account. Optional — nothing changes until you connect.',
      testId: 'rc-integration-card',
      content: <IntegrationsSection projectId={project.id} />,
    });
  }

  if (project && isOwner) {
    panels.push({
      id: 'danger-zone',
      label: 'Danger zone',
      icon: AlertTriangle,
      tone: 'danger',
      description: 'Irreversible actions. Both ask for a confirmation first.',
      content: (
        <DangerZonePanel
          projectId={project.id}
          projectName={project.name}
          onDeleted={() => router.history.push('/projects')}
        />
      ),
    });
  }

  return (
    <SettingsLayout
      projectId={projectId}
      projectName={project?.name ?? 'Project'}
      scope="ampix"
      panels={panels}
    />
  );
}

// --- General ------------------------------------------------------------------

function RenameProjectForm({
  projectId,
  currentName,
  currentTimezone,
}: {
  projectId: string;
  currentName: string;
  currentTimezone: string;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(currentName);
  const [timezone, setTimezone] = useState(currentTimezone);
  useEffect(() => setName(currentName), [currentName]);
  useEffect(() => setTimezone(currentTimezone), [currentTimezone]);
  const mutation = useUpdateProject(projectId);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    mutation.mutate(
      { name: name.trim(), timezone: timezone.trim() || undefined },
      {
        onSuccess: () => toast({ title: 'Project updated' }),
        onError: (error) =>
          toast({
            title: 'Could not update project',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <SettingRows>
        <SettingRow
          htmlFor="project-name"
          label="Name"
          hint="Shown in the project switcher and on every report."
        >
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-64 max-w-full"
          />
        </SettingRow>
        <SettingRow
          htmlFor="project-timezone"
          label="Timezone"
          hint="The day boundary every report, funnel, and retention grid is bucketed by."
        >
          <Input
            id="project-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-64 max-w-full"
          />
        </SettingRow>
      </SettingRows>
      <div className="mt-5 flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={mutation.isPending || !name.trim()}>
          {mutation.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

// --- SDK log level ------------------------------------------------------------

const LOG_LEVELS = ['none', 'error', 'warn', 'info', 'debug'] as const;

/** Read-only guidance: the log level is an SDK-side config, not a server setting. */
function LogLevelPanel() {
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-text-muted">
        <Badge variant="outline" className="mr-2 align-middle">
          SDK-side
        </Badge>
        It is set in your app&apos;s config, not here — there is no server setting to change.
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {LOG_LEVELS.map((level, index) => (
          <span key={level} className="flex items-center gap-1.5">
            <code className="rounded-lg bg-surface-raised px-1.5 py-0.5 font-mono text-xs">
              {level}
            </code>
            {index < LOG_LEVELS.length - 1 && <span aria-hidden="true">·</span>}
          </span>
        ))}
      </div>
      <p className="text-xs text-text-muted">
        Ascending verbosity, left to right. Default is <code className="font-mono">none</code>.
      </p>
      <pre className="overflow-x-auto rounded-lg bg-surface-raised px-3 py-2 font-mono text-xs">
        <code>MyAmpixConfig(logLevel: MyAmpixLogLevel.warn)</code>
      </pre>
    </div>
  );
}

// --- Data ---------------------------------------------------------------------

function DataPanel({
  projectId,
  project,
}: {
  projectId: string;
  project: { id: string; timezone: string; org_name: string } | undefined;
}) {
  const { data: summary, isPending, error } = useEventSummary(projectId);

  return (
    <div className="space-y-5">
      {isPending && <p role="status">Loading event summary…</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load event summary'}
        </p>
      )}

      {summary && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface-raised/40 px-4 py-3">
            <p className="text-sm text-text-muted">Total events</p>
            <p className="font-display text-3xl font-semibold tabular-nums">{summary.total}</p>
          </div>

          {summary.total === 0 ? (
            <EmptyState icon={Inbox} title="No events yet — send some from your app" />
          ) : (
            <CollapsibleSection title="Events by name" defaultOpen={false}>
              <DataTable
                caption="Events by name"
                columns={[
                  { key: 'event', header: 'Event', sortable: true },
                  { key: 'count', header: 'Count', align: 'right', sortable: true },
                ]}
                rows={summary.by_event}
                rowKey={(row) => row.event}
              />
            </CollapsibleSection>
          )}
        </div>
      )}

      {project && (
        <SettingRows>
          <Fact label="Organization" value={project.org_name} />
          <Fact label="Timezone" value={project.timezone} />
          <Fact
            label="Project ID"
            value={<code className="font-mono text-xs">{project.id}</code>}
          />
        </SettingRows>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <SettingRow label={label}>
      <span className="text-sm text-text-muted">{value}</span>
    </SettingRow>
  );
}
