import { Link, useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { ApiError } from '../../../lib/api/problem';
import { useUsersList } from '../api';
import { PageShell } from '../../../components/layout/PageShell';

export function UsersPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/users' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useUsersList(projectId, search);

  const users = data?.pages.flatMap((page) => page.users) ?? [];

  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
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
            Search by distinct ID
          </label>
          <Input
            id="user-search"
            placeholder="e.g. user-001"
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
          <table className="w-full max-w-2xl border-collapse text-left text-sm">
            <caption className="sr-only">Users</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 font-medium">
                  Distinct ID
                </th>
                <th scope="col" className="py-2 font-medium">
                  Last seen
                </th>
                <th scope="col" className="py-2 font-medium">
                  Events
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.distinct_id} className="border-b border-border">
                  <td className="py-2">
                    <Link
                      to="/projects/$projectId/users/$distinctId"
                      params={{ projectId, distinctId: user.distinct_id }}
                      className="text-accent underline"
                    >
                      {user.distinct_id}
                    </Link>
                  </td>
                  <td className="py-2">{new Date(user.last_seen).toLocaleString()}</td>
                  <td className="py-2">{user.event_count}</td>
                </tr>
              ))}
            </tbody>
          </table>

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
