/**
 * The collapsed rail's stand-in for a name. A 24px square holding one letter — enough to tell two
 * workspaces (or projects) apart at a glance without the 240px the full name needs. The name it
 * abbreviates is never the trigger's accessible name (the `Menu`'s own `label` is), so dropping it
 * to a single glyph costs nothing for screen readers; `title` covers the sighted-hover case.
 */
export function RailInitial({ name, fallback }: { name?: string; fallback: string }) {
  const initial = name?.trim().charAt(0).toUpperCase() || fallback;
  return (
    <span
      aria-hidden="true"
      title={name}
      className="flex size-6 items-center justify-center rounded text-sm font-semibold text-text"
    >
      {initial}
    </span>
  );
}
