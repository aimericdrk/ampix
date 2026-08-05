import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ui/toast';
import { ThemeProvider } from '../lib/theme';
import { routeTree } from '../router';

/** Mount the real route tree at a URL with fresh providers and memory history. */
export function renderApp(initialUrl: string) {
  const history = createMemoryHistory({ initialEntries: [initialUrl] });
  const router = createRouter({ routeTree, history });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return { router };
}

/**
 * Hover the sidebar so it expands out of its icon-only resting state. Anything that asserts on
 * sidebar *text* — workspace/project names, nav labels, the wordmark — needs this first; the
 * collapsed rail shows glyphs only. Assertions on accessible names do not, since collapsed labels
 * go `sr-only` rather than away.
 */
export async function expandSidebar() {
  // `find`, not `get`: callers reach for this straight after `renderApp`, before the route has
  // resolved and put the sidebar in the DOM.
  await userEvent.hover(await screen.findByTestId('global-sidebar'));
}
