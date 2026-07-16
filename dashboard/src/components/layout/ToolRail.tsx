import { Link } from '@tanstack/react-router';
import { cn } from '../../lib/cn';
import { NavIcon } from './NavIcon';
import { TOOLS, type ToolId } from './nav-model';

const TOOL_LINK_BASE =
  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-text-muted transition-colors hover:text-text';
const TOOL_LINK_ACTIVE = 'bg-surface-raised text-accent shadow-sm';

/**
 * The tool switcher: one segment per product surface (MyAmplitude, MyRevenueCat). Adding a tool is
 * one entry in `TOOLS` — nothing here is per-tool. Rendered as an inset stack of full-width segments
 * at the top of the global sidebar, so "which product am I in" reads as a switch, distinct from the
 * section nav in the column beside it.
 *
 * Full-width (not a two-up grid): "MyRevenueCat" is a single unbreakable word ~87px wide, which
 * clips in a half-column segment but fits with room to spare across the whole column — the same
 * reason the section nav renders equally long labels ("Integration settings") on one line.
 *
 * Deliberately always renders every tool, including ones the project hasn't connected: hiding
 * MyRevenueCat until RevenueCat is set up makes the feature undiscoverable to exactly the people
 * who haven't adopted it. An unconnected tool's home route explains how to connect instead.
 */
export function ToolRail({ activeTool, projectId }: { activeTool: ToolId; projectId?: string }) {
  // Tools are project-scoped; off a project route there is nothing to switch between.
  if (!projectId) return null;

  return (
    <nav aria-label="Tools" className="flex flex-col gap-1 rounded-lg bg-bg p-1">
      {TOOLS.map((tool) => {
        const active = tool.id === activeTool;
        return (
          <Link
            key={tool.id}
            to={tool.home}
            params={{ projectId }}
            // Without this, TanStack's own non-exact prefix match can independently decide a
            // link is active and OR its `aria-current="page"` into ours (see SidebarLink's
            // comment on the union semantics) — today no tool's `home` route is a prefix of
            // another tool's routes, so this is latent rather than visibly broken, but a future
            // tool homed at a shared prefix would silently double-mark the switcher.
            activeOptions={{ exact: true }}
            className={cn(TOOL_LINK_BASE, active && TOOL_LINK_ACTIVE)}
            aria-current={active ? 'page' : undefined}
          >
            <NavIcon name={tool.icon} />
            {/* `truncate` is only a graceful fallback for a future label longer than the column,
                not load-bearing — every current label fits on one line. */}
            <span className="truncate">{tool.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
