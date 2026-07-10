import { Link } from '@tanstack/react-router';
import { FileQuestion } from 'lucide-react';
import { buttonVariants } from './ui/button';
import { cn } from '../lib/cn';

/** Full-page 404 — the same centered icon-glow treatment as `EmptyState`, but with a real `<h1>`
 * (unlike `EmptyState`'s `<p>` title) since this is the page's only heading. */
export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
      <div className="relative mb-1 flex items-center justify-center">
        <div className="absolute size-28 rounded-full bg-gradient-brand opacity-20 blur-2xl" />
        <p className="relative font-display text-6xl font-semibold text-gradient-brand">404</p>
      </div>
      <div className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent [&_svg]:size-6">
        <FileQuestion aria-hidden="true" />
      </div>
      <h1 className="font-display text-lg font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-text-muted">The page you are looking for does not exist.</p>
      <Link to="/projects" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-2')}>
        Back to projects
      </Link>
    </main>
  );
}
