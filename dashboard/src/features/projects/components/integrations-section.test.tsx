import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import { RC_STATUS_FIXTURE, TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

const SETTINGS_URL = `/projects/${TEST_PROJECT.id}`;

describe('IntegrationsSection', () => {
  it('shows the RevenueCat card with webhook URL and secret when connected', async () => {
    signIn();
    renderApp(SETTINGS_URL);

    const card = await screen.findByTestId('rc-integration-card');
    expect(
      await within(card).findByText(new RegExp(RC_STATUS_FIXTURE.webhook_secret)),
    ).toBeInTheDocument();
    expect(within(card).getByText(/webhooks\/revenuecat/)).toBeInTheDocument();
    expect(within(card).getByText(/…1234/)).toBeInTheDocument();
  });

  it('offers the connect form when not connected', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/integrations/revenuecat', () =>
        HttpResponse.json({ ...RC_STATUS_FIXTURE, connected: false, webhook_secret: '' }),
      ),
    );
    signIn();
    renderApp(SETTINGS_URL);

    const card = await screen.findByTestId('rc-integration-card');
    expect(await within(card).findByLabelText(/secret api key/i)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  it('is absent for non-admin roles', async () => {
    server.use(
      http.get('/api/v1/projects', () =>
        HttpResponse.json({ projects: [{ ...TEST_PROJECT, role: 'analyst' }] }),
      ),
    );
    signIn();
    renderApp(SETTINGS_URL);

    await screen.findByRole('main');
    await waitFor(() => expect(screen.queryByTestId('rc-integration-card')).not.toBeInTheDocument());
  });

  it('sends the PUT on connect', async () => {
    let putBody: unknown;
    server.use(
      http.get('/api/v1/projects/:projectId/integrations/revenuecat', () =>
        HttpResponse.json({ ...RC_STATUS_FIXTURE, connected: false, webhook_secret: '' }),
      ),
      http.put('/api/v1/projects/:projectId/integrations/revenuecat', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json(RC_STATUS_FIXTURE);
      }),
    );
    signIn();
    renderApp(SETTINGS_URL);

    const card = await screen.findByTestId('rc-integration-card');
    await userEvent.type(await within(card).findByLabelText(/secret api key/i), 'sk_test_123');
    await userEvent.type(within(card).getByLabelText(/rc project id/i), 'proj1');
    await userEvent.click(within(card).getByRole('button', { name: /connect/i }));

    await waitFor(() => expect(putBody).toEqual({ api_key: 'sk_test_123', rc_project_id: 'proj1' }));
  });

  it('disconnects behind a confirm dialog', async () => {
    let disconnected = false;
    server.use(
      http.delete('/api/v1/projects/:projectId/integrations/revenuecat', () => {
        disconnected = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    signIn();
    renderApp(SETTINGS_URL);

    const card = await screen.findByTestId('rc-integration-card');
    await userEvent.click(await within(card).findByRole('button', { name: /disconnect/i }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Historical subscription data is kept; the webhook stops being accepted\./),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /disconnect/i }));

    await waitFor(() => expect(disconnected).toBe(true));
  });
});
