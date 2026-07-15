import { Link } from '@tanstack/react-router';
import { cn } from '../../lib/cn';
import { NavIcon } from './NavIcon';
import { TOOLS, type ToolId } from './nav-model';

const TOOL_LINK_BASE =
  'flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text';
const TOOL_LINK_ACTIVE = 'bg-accent-soft text-accent';

/**
 * The tool switcher: one button per product surface (MyAmplitude, MyRevenueCat). Adding a tool is
 * one entry in `TOOLS` — nothing here is per-tool.
 *
 * Deliberately always renders every tool, including ones the project hasn't connected: hiding
 * MyRevenueCat until RevenueCat is set up makes the feature undiscoverable to exactly the people
 * who haven't adopted it. An unconnected tool's home route explains how to connect instead.
 */
export function ToolRail({ activeTool, projectId }: { activeTool: ToolId; projectId?: string }) {
  // Tools are project-scoped; off a project route there is nothing to switch between.
  if (!projectId) return null;

  return (
    <nav aria-label="Tools" className="flex flex-col gap-1">
      {TOOLS.map((tool) => {
        const active = tool.id === activeTool;
        return (
          <Link
            key={tool.id}
            to={tool.home}
            params={{ projectId }}
            className={cn(TOOL_LINK_BASE, active && TOOL_LINK_ACTIVE)}
            aria-current={active ? 'page' : undefined}
          >
            <NavIcon name={tool.icon} />
            {/* Fixed 2-line box (not `truncate`): at the rail's narrow width the longest tool
                label ("MyRevenueCat") doesn't fit on one line, so it wraps instead of clipping.
                Reserving 2 lines' worth of height for every label — long or short — keeps every
                button the same height, so a wrapped label doesn't disrupt the rail's rhythm. */}
            <span className="flex h-[2.5em] w-full items-center justify-center break-words text-center leading-tight">
              {tool.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
