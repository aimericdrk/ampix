import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  CalendarPlus,
  Clock,
  EyeOff,
  Inbox,
  Search,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '../../../components/ui/avatar';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { CollapsibleSection } from '../../../components/ui/CollapsibleSection';
import { EmptyState } from '../../../components/ui/empty-state';
import { IconButton } from '../../../components/ui/icon-button';
import { Input } from '../../../components/ui/input';
import { Reveal } from '../../../components/ui/reveal';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import type { UserListItem } from '../../../lib/api/types';
import { formatExactNumber } from '../format';
import { contactFromListItem } from '../user-identity';
import { useHiddenUsers, useUnhideUser, useUsersList } from '../api';
import { PageShell } from '../../../components/layout/PageShell';
import { RemoveUserDialog } from './RemoveUserDialog';
import { UserProfileModal } from './UserProfileModal';

/** Monogram for the avatar — initials from the name, falling back to the distinct id. */
function initials(name: string | null, distinctId: string): string {
  const source = ((name && name.trim()) || distinctId || '?').trim();
  const words = source
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const first = words[0] ?? source;
  const second = words[1];
  const chars = second ? `${first.charAt(0)}${second.charAt(0)}` : source.slice(0, 2);
  return chars.toUpperCase() || '?';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** One metric on a user card: a muted icon, the value, and a small label beneath. */
function UserStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-text-muted" aria-hidden />
      <div className="leading-tight">
        <div className="text-sm font-semibold tabular-nums">{value}</div>
        <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      </div>
    </div>
  );
}

export function UsersPage() {
  // Loose params: this component backs BOTH `/users` and `/users/$distinctId`. On the latter the
  // `distinctId` is present and auto-opens the profile modal (deep-links, favorites, command
  // palette). `strict: false` reads whichever params the current match actually has.
  const { projectId, distinctId: routeDistinctId } = useParams({ strict: false }) as {
    projectId: string;
    distinctId?: string;
  };
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // The user whose profile modal is open, or null when closed. Seeded from the URL so a deep-link
  // lands with the modal already open over the list.
  const [openDistinctId, setOpenDistinctId] = useState<string | null>(routeDistinctId ?? null);
  // The user the remove dialog is asking about, or null when it is closed. Held as the whole row
  // (not just the id) so the dialog can name the person rather than echo an opaque id back at them.
  const [removing, setRemoving] = useState<UserListItem | null>(null);
  const { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useUsersList(projectId, search);
  const hiddenUsers = useHiddenUsers(projectId);
  const unhideUser = useUnhideUser(projectId);
  const { toast } = useToast();

  const users = data?.pages.flatMap((page) => page.users) ?? [];
  const hidden = hiddenUsers.data?.users ?? [];

  const handleUnhide = (distinctId: string) => {
    unhideUser.mutate(distinctId, {
      onSuccess: () => toast({ title: 'User restored to the list' }),
      onError: (unhideError) =>
        toast({
          title:
            unhideError instanceof ApiError ? unhideError.problem.title : 'Failed to un-hide user',
          variant: 'error',
        }),
    });
  };

  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  // Open the modal when the URL carries a distinctId (navigating favorite→favorite keeps the same
  // route mounted, so `useState`'s initial value alone would not re-open for the next user).
  useEffect(() => {
    if (routeDistinctId) setOpenDistinctId(routeDistinctId);
  }, [routeDistinctId]);

  const openProfile = (user: UserListItem) => setOpenDistinctId(user.distinct_id);

  const closeProfile = () => {
    setOpenDistinctId(null);
    // If we arrived via a `/users/$distinctId` deep-link, drop back to the plain list URL so the
    // address bar matches what's on screen once the modal is dismissed.
    if (routeDistinctId) {
      void navigate({ to: '/projects/$projectId/users', params: { projectId } });
    }
  };

  return (
    <PageShell
      projectId={projectId}
      title="Users"
      description="Search and browse the people behind your events."
      breadcrumbs={[{ label: 'Audience' }, { label: 'Users' }]}
    >
      <Reveal index={0}>
        <form onSubmit={handleSearchSubmit} className="max-w-xl">
          <label htmlFor="user-search" className="mb-1.5 block text-sm font-medium">
            Search by name, email, or ID
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
                aria-hidden
              />
              <Input
                id="user-search"
                placeholder="Search users…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-11 pl-9"
              />
            </div>
            <Button type="submit" className="h-11">
              Search
            </Button>
          </div>
        </form>
      </Reveal>

      {isPending && (
        <Reveal index={1}>
          <p role="status">Loading users…</p>
        </Reveal>
      )}
      {isError && (
        <Reveal index={1}>
          <p role="alert" className="text-danger">
            {error instanceof ApiError ? error.problem.title : 'Failed to load users'}
          </p>
        </Reveal>
      )}

      {!isPending && !isError && users.length === 0 && (
        <Reveal index={1}>
          <EmptyState icon={Inbox} title="No users found." />
        </Reveal>
      )}

      {users.length > 0 && (
        <Reveal index={1} className="flex flex-col gap-3">
          <ul aria-label="Users" className="flex flex-col gap-3">
            {users.map((user) => (
              <li
                key={user.distinct_id}
                className="flex items-center gap-2 rounded-xl border border-border bg-surface pr-3 transition-colors focus-within:border-accent hover:border-accent"
              >
                {/* The row's own click target. A separate sibling — not a wrapper — so the remove
                    control below is a real button and not one nested inside another. */}
                <button
                  type="button"
                  onClick={() => openProfile(user)}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-4 rounded-xl p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Avatar size="lg">
                    <AvatarFallback className="text-sm font-semibold">
                      {initials(user.name, user.distinct_id)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">
                      {user.name ?? 'Unknown user'}
                    </div>
                    <div className="truncate font-mono text-xs text-text-muted">
                      {contactFromListItem(user)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2">
                    <UserStat
                      icon={Activity}
                      label="Events"
                      value={formatExactNumber(user.event_count)}
                    />
                    <UserStat
                      icon={CalendarPlus}
                      label="First seen"
                      value={formatDate(user.first_seen)}
                    />
                    <UserStat icon={Clock} label="Last seen" value={formatDate(user.last_seen)} />
                  </div>
                </button>
                <IconButton
                  aria-label={`Remove ${user.name ?? user.distinct_id}`}
                  title="Remove this user"
                  onClick={() => setRemoving(user)}
                  className="hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>

          {hasNextPage && (
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </Reveal>
      )}

      {hidden.length > 0 && (
        <Reveal index={2}>
          <CollapsibleSection title={`Hidden users (${hidden.length})`} defaultOpen={false}>
            <p className="mb-3 text-sm text-text-muted">
              Removed from this list but not deleted — their events are kept and still count in
              every chart.
            </p>
            <ul aria-label="Hidden users" className="flex flex-col gap-2">
              {hidden.map((entry) => (
                <li
                  key={entry.distinct_id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <EyeOff className="size-4 shrink-0 text-text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {entry.distinct_id}
                  </span>
                  <Badge variant="outline">
                    {entry.hidden_by ? `Hidden by ${entry.hidden_by}` : 'Hidden'} ·{' '}
                    {formatDate(entry.hidden_at)}
                  </Badge>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    disabled={unhideUser.isPending}
                    onClick={() => handleUnhide(entry.distinct_id)}
                  >
                    <Undo2 className="size-3.5" aria-hidden />
                    Un-hide
                  </Button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </Reveal>
      )}

      {openDistinctId && (
        <UserProfileModal
          projectId={projectId}
          distinctId={openDistinctId}
          onClose={closeProfile}
        />
      )}

      {removing && (
        <RemoveUserDialog
          projectId={projectId}
          distinctId={removing.distinct_id}
          displayName={removing.name ?? removing.email ?? removing.distinct_id}
          open
          onOpenChange={(next) => {
            if (!next) setRemoving(null);
          }}
          onRemoved={() => {
            // The removed user may be the one whose profile is open behind the dialog; that modal
            // would otherwise sit there showing a person who is no longer in the list.
            if (openDistinctId === removing.distinct_id) closeProfile();
            setRemoving(null);
          }}
        />
      )}
    </PageShell>
  );
}
