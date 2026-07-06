import { useNavigate, useParams } from '@tanstack/react-router';
import { useCurrentOrgId } from '../../features/orgs/store';
import { useProjects } from '../../features/projects/api';
import { cn } from '../../lib/cn';
import { Menu, MENU_ITEM_CLASS, MenuCheck } from '../ui/menu';

/**
 * Project selector — lists the current org's projects plus an "All projects"
 * option and navigates to the chosen destination. Scoped to `currentOrgId`
 * because `GET /projects` returns projects across every org the user belongs to.
 */
export function ProjectSwitcher() {
  const navigate = useNavigate();
  const currentOrgId = useCurrentOrgId();
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const { data } = useProjects();

  const projects = (data?.projects ?? []).filter(
    (project) => currentOrgId === null || project.org_id === currentOrgId,
  );
  const activeProject = data?.projects.find((project) => project.id === projectId);
  const onAllProjects = !projectId;

  return (
    <Menu
      label="Switch project"
      trigger={
        <span className="flex flex-col">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
            Project
          </span>
          <span className="truncate text-sm font-medium text-text">
            {activeProject?.name ?? 'All projects'}
          </span>
        </span>
      }
    >
      {({ close }) => (
        <>
          <button
            type="button"
            role="menuitem"
            aria-current={onAllProjects ? 'true' : undefined}
            className={MENU_ITEM_CLASS}
            onClick={() => {
              close();
              void navigate({ to: '/projects' });
            }}
          >
            <MenuCheck hidden={!onAllProjects} />
            <span className={onAllProjects ? 'font-medium' : undefined}>All projects</span>
          </button>

          <div className="my-1 border-t border-border" role="separator" />

          {projects.length === 0 && (
            <p className="px-2.5 py-2 text-sm text-text-muted">No projects in this workspace yet.</p>
          )}
          {projects.map((project) => {
            const active = project.id === projectId;
            return (
              <button
                key={project.id}
                type="button"
                role="menuitem"
                aria-current={active ? 'true' : undefined}
                className={MENU_ITEM_CLASS}
                onClick={() => {
                  close();
                  void navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
                }}
              >
                <MenuCheck hidden={!active} />
                <span className={cn('truncate', active && 'font-medium')}>{project.name}</span>
              </button>
            );
          })}
        </>
      )}
    </Menu>
  );
}
