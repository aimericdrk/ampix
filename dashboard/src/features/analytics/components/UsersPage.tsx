import { useNavigate, useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { ApiError } from '../../../lib/api/problem';
import type { UserListItem } from '../../../lib/api/types';
import { formatExactNumber } from '../format';
import { useUsersList } from '../api';
import { PageShell } from '../../../components/layout/PageShell';

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
  const { projectId } = useParams({ from: '/private/projects/$projectId/users' });
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useUsersList(projectId, search);

  const users = data?.pages.flatMap((page) => page.users) ?? [];

  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  const goToProfile = (user: UserListItem) => {
    void navigate({
      to: '/projects/$projectId/users/$distinctId',
      params: { projectId, distinctId: user.distinct_id },
    });
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
            onRowClick={goToProfile}
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
    </PageShell>
  );
}
