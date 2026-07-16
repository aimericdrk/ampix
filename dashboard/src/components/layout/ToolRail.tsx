import { Link } from '@tanstack/react-router';
import { cn } from '../../lib/cn';
import { NavIcon } from './NavIcon';
import { TOOLS, type ToolId } from './nav-model';

const TILE_BASE =
  'group flex flex-col items-center gap-1.5 rounded-lg px-1 py-1.5 text-text-muted transition-colors hover:text-text';
// The square glyph "app icon". `[&_svg]:size-6` scales NavIcon's default 16px glyph up to 24px for
// the larger tile, the same override pattern EmptyState uses.
const TILE_INNER_BASE =
  'flex size-14 items-center justify-center rounded-xl border transition-colors [&_svg]:size-6';
const TILE_INNER_ACTIVE = 'border-accent bg-accent-soft text-accent';
const TILE_INNER_IDLE =
  'border-border bg-surface-raised text-text-muted group-hover:border-border-strong group-hover:text-text';

/**
 * The tool switcher: one app-launcher tile per product surface (MyAmplitude, MyRevenueCat) — a
 * square icon with its label beneath, like a mobile home screen. Adding a tool is one entry in
 * `TOOLS`; nothing here is per-tool. Sits under the workspace + project pickers in the global
 * sidebar.
 *
 * Deliberately always renders every tool, including ones the project hasn't connected: hiding
 * MyRevenueCat until RevenueCat is set up makes the feature undiscoverable to exactly the people
 * who haven't adopted it. An unconnected tool's home route explains how to connect instead.
 */
export function ToolRail({ activeTool, projectId }: { activeTool: ToolId; projectId?: string }) {
  // Tools are project-scoped; off a project route there is nothing to switch between.
  if (!projectId) return null;

  return (
    <nav aria-label="Tools" className="grid grid-cols-2 gap-2">
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
            className={cn(TILE_BASE, active && 'text-accent')}
            aria-current={active ? 'page' : undefined}
          >
            <span className={cn(TILE_INNER_BASE, active ? TILE_INNER_ACTIVE : TILE_INNER_IDLE)}>
              <NavIcon name={tool.icon} />
            </span>
            {/* Label under the tile. `truncate` is a graceful fallback for a future label longer
                than the tile; every current label fits at this size. */}
            <span className="max-w-full truncate text-[11px] font-medium">{tool.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
