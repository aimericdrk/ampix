import { Button } from '../ui/button';

/** Stub: becomes a real Radix listbox when multi-project navigation lands (milestone 2). */
export function ProjectSwitcher() {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="w-full justify-between"
      disabled
      title="Project switching arrives with the tenancy milestone"
    >
      All projects <span aria-hidden>▾</span>
    </Button>
  );
}
