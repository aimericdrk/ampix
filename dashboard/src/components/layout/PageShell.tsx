import { Link } from '@tanstack/react-router';
import { type ReactNode } from 'react';
import { PageHeader } from '../ui/page-header';
import { Reveal } from '../ui/reveal';

export interface Breadcrumb {
  label: string;
  /** A TanStack route path; omit for the current (non-link) page. */
  to?: string;
  params?: Record<string, string>;
}

/**
 * The consistent page frame every screen wears: optional breadcrumbs, a title, a short description,
 * and a right-aligned primary-action slot — so pages feel uniform and calm. When a `projectId` is
 * given, a leading "Home" breadcrumb linking to the project overview is prepended automatically.
 * Children are laid out in a single column with the standard 6-gap rhythm.
 */
export function PageShell({
  projectId,
  title,
  description,
  breadcrumbs,
  dateRangeControl,
  actions,
  children,
}: {
  projectId?: string;
  title: string;
  description?: ReactNode;
  breadcrumbs?: Breadcrumb[];
  /** An optional header-area control (e.g. the global `DateRangeControl`), rendered ahead of
   * `actions`. Opt-in per page — omitting it changes nothing for existing pages. */
  dateRangeControl?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const crumbs: Breadcrumb[] = [];
  if (projectId && breadcrumbs && breadcrumbs.length > 0) {
    crumbs.push({ label: 'Home', to: '/projects/$projectId/home', params: { projectId } });
  }
  if (breadcrumbs) crumbs.push(...breadcrumbs);

  const breadcrumbNav =
    crumbs.length > 0 ? (
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                {crumb.to && !isLast ? (
                  <Link
                    to={crumb.to}
                    params={crumb.params}
                    className="hover:text-text hover:underline"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'text-text' : undefined}>
                    {crumb.label}
                  </span>
                )}
                {!isLast && <span aria-hidden="true">/</span>}
              </li>
            );
          })}
        </ol>
      </nav>
    ) : undefined;

  const headerActions =
    dateRangeControl || actions ? (
      <>
        {dateRangeControl}
        {actions}
      </>
    ) : undefined;

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title={title} description={description} breadcrumbs={breadcrumbNav} actions={headerActions} />
      <Reveal delay={0.05}>{children}</Reveal>
    </section>
  );
}
