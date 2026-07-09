import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { ApiError } from '../../../lib/api/problem';
import type { UserListItem } from '../../../lib/api/types';
import { formatExactNumber } from '../format';
import { useUsersList } from '../api';
import { PageShell } from '../../../components/layout/PageShell';
import { UserProfileModal } from './UserProfileModal';

const columns: Array<DataTableColumn<UserListItem>> = [
  {
    key: 'name',
    header: 'Name',
    sortable: true,
    sortValue: (user) => user.name ?? '',
    render: (user) => user.name ?? '—',
  },
  {
    key: 'id',
    header: 'ID / email',
    sortable: true,
    sortValue: (user) => user.email ?? user.distinct_id,
    render: (user) => (
      <span className="font-mono text-xs">{user.email ?? user.distinct_id}</span>
    ),
  },
  {
    key: 'last_seen',
    header: 'Last seen',
    sortable: true,
    sortValue: (user) => user.last_seen,
    render: (user) => new Date(user.last_seen).toLocaleDateString(),
  },
  {
    key: 'event_count',
    header: 'Events',
    align: 'right',
    sortable: true,
    sortValue: (user) => user.event_count,
    render: (user) => formatExactNumber(user.event_count),
  },
];

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
  const { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useUsersList(projectId, search);

  const users = data?.pages.flatMap((page) => page.users) ?? [];

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
      <form onSubmit={handleSearchSubmit} className="flex max-w-sm items-end gap-2">
        <div className="flex-1">
          <label htmlFor="user-search" className="mb-1 block text-sm font-medium">
            Search by name, email, or ID
          </label>
          <Input
            id="user-search"
            placeholder="e.g. Alex or user-001"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm">
          Search
        </Button>
      </form>

      {isPending && <p role="status">Loading users…</p>}
      {isError && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load users'}
        </p>
      )}

      {!isPending && !isError && users.length === 0 && (
        <p className="text-text-muted">No users found.</p>
      )}

      {users.length > 0 && (
        <>
          <DataTable
            columns={columns}
            rows={users}
            caption="Users"
            rowKey={(user) => user.distinct_id}
            onRowClick={openProfile}
            exportFilename="users"
          />

          {hasNextPage && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}

      {openDistinctId && (
        <UserProfileModal
          projectId={projectId}
          distinctId={openDistinctId}
          onClose={closeProfile}
        />
      )}
    </PageShell>
  );
}
