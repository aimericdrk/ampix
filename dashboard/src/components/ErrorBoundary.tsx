import { Component, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from './ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        // Same centered icon-glow treatment as `EmptyState`, but with a real `<h1>` (unlike
        // `EmptyState`'s `<p>` title) since this is the page's only heading.
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
          <div className="relative mb-1 flex items-center justify-center">
            <div className="absolute size-24 rounded-full bg-danger-soft opacity-60 blur-2xl" />
            <div className="relative flex size-12 items-center justify-center rounded-xl bg-danger-soft text-danger [&_svg]:size-6">
              <CircleAlert aria-hidden="true" />
            </div>
          </div>
          <h1 className="font-display text-lg font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-text-muted">{this.state.error.message}</p>
          <Button className="mt-2" onClick={() => window.location.assign('/')}>
            Reload MyAmpix
          </Button>
        </main>
      );
    }
    return this.props.children;
  }
}
