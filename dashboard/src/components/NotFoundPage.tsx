import { Link } from '@tanstack/react-router';

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-text-muted">The page you are looking for does not exist.</p>
      <Link to="/projects" className="text-accent underline">
        Back to projects
      </Link>
    </main>
  );
}
