import { Button } from './ui/button';

export function RouteErrorPage({ error }: { error: Error }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-center text-text-muted">{error.message}</p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </main>
  );
}
