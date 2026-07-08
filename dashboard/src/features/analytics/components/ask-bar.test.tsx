import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { InsightsQueryDefinition } from '../../../lib/api/types';
import { ToastProvider } from '../../../components/ui/toast';
import { authStore } from '../../auth/store';
import { ASK_DATA_FIXTURE, TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { AskBar } from './AskBar';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

function renderAskBar(onResult = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AskBar projectId={TEST_PROJECT.id} onResult={onResult} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onResult };
}

describe('AskBar', () => {
  it('has a labelled, accessible input with a prominent placeholder', () => {
    signIn();
    renderAskBar();
    const input = screen.getByLabelText('Ask your data');
    expect(input).toHaveAttribute('placeholder', 'Ask your data…');
    expect(input).not.toBeDisabled();
  });

  it('submits the typed question and calls onResult with the returned definition', async () => {
    signIn();
    let capturedBody: { question?: string } | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/ask', async ({ request }) => {
        capturedBody = (await request.json()) as { question?: string };
        // A tiny delay so the pending ("Thinking…") state is actually observable below, instead
        // of the mocked response settling within the same tick as the click.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({
          question: capturedBody.question,
          definition: ASK_DATA_FIXTURE,
        });
      }),
    );

    const onResult = vi.fn();
    renderAskBar(onResult);

    const input = screen.getByLabelText('Ask your data');
    await userEvent.type(input, 'conversion rate by OS over the last 30 days');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByRole('button', { name: 'Thinking…' })).toBeDisabled();
    expect(input).toBeDisabled();

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(capturedBody?.question).toBe('conversion rate by OS over the last 30 days');
    const [definition, question] = onResult.mock.calls[0] as [InsightsQueryDefinition, string];
    expect(definition).toEqual(ASK_DATA_FIXTURE);
    expect(question).toBe('conversion rate by OS over the last 30 days');

    // The input clears and re-enables once the request settles.
    await waitFor(() => expect(input).toHaveValue(''));
    expect(input).not.toBeDisabled();
  });

  it('does not submit a blank/whitespace-only question', async () => {
    signIn();
    const onResult = vi.fn();
    renderAskBar(onResult);

    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Ask your data'), '   ');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('shows a friendly "not configured" message on a 503', async () => {
    signIn();
    server.use(
      http.post('/api/v1/projects/:projectId/query/ask', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'AI query is not configured', status: 503 },
          { status: 503 },
        ),
      ),
    );

    const onResult = vi.fn();
    renderAskBar(onResult);
    await userEvent.type(screen.getByLabelText('Ask your data'), 'top events for iOS');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText("AI query isn't set up (no Mistral key)")).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('shows a friendly "try rephrasing" message on a 422', async () => {
    signIn();
    server.use(
      http.post('/api/v1/projects/:projectId/query/ask', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Could not turn that into a query', status: 422 },
          { status: 422 },
        ),
      ),
    );

    const onResult = vi.fn();
    renderAskBar(onResult);
    await userEvent.type(screen.getByLabelText('Ask your data'), 'asdkjhasd garbage question');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(
      await screen.findByText("I couldn't turn that into a query — try rephrasing"),
    ).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('shows a generic message for any other failure', async () => {
    signIn();
    server.use(
      http.post('/api/v1/projects/:projectId/query/ask', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal Server Error', status: 500 },
          { status: 500 },
        ),
      ),
    );

    const onResult = vi.fn();
    renderAskBar(onResult);
    await userEvent.type(screen.getByLabelText('Ask your data'), 'daily active users this month');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(
      await screen.findByText('Something went wrong asking your data — try again'),
    ).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
  });
});
