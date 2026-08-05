import { Link } from '@tanstack/react-router';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { NavIcon } from './NavIcon';

/**
 * The rail's identity cluster. The rail is too narrow for the text links this replaced, so the
 * signed-in email, Account, Organization settings, and Log out collapse into one popover — the
 * standard pattern for a narrow rail. Accessible names are unchanged from when these were direct
 * links, only their location moved.
 */
export function RailIdentityMenu({
  email,
  orgId,
  onLogout,
}: {
  email?: string;
  orgId: string | null;
  onLogout: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="w-auto px-2" aria-label="Account menu">
          <NavIcon name="account" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-56">
        {email && <DropdownMenuLabel className="truncate font-normal text-text-muted">{email}</DropdownMenuLabel>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">Account</Link>
        </DropdownMenuItem>
        {orgId && (
          <DropdownMenuItem asChild>
            <Link to="/orgs/$orgId/settings" params={{ orgId }}>
              Organization settings
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
