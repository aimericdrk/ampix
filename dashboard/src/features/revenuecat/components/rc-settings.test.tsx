import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

const PID = TEST_PROJECT.id;
const SETTINGS_URL = `/projects/${PID}/rc/settings`;
const catalogBase = `/api/v1/projects/${PID}/catalog`;

function problem(status: number, title: string, extra: Record<string, unknown> = {}) {
  return HttpResponse.json(
    { type: 'about:blank', title, status, ...extra },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

interface FixtureApp {
  id: string;
  name: string;
  platform: string;
  bundleId: string | null;
  packageName: string | null;
  publicSdkKey: string;
  storeConnected: boolean;
  storeCredentialsLiveVerified: boolean;
}

const IOS_APP: FixtureApp = {
  id: 'app-ios',
  name: 'Aurora iOS',
  platform: 'IOS',
  bundleId: 'com.example.aurora',
  packageName: null,
  publicSdkKey: 'mp_pub_ios',
  storeConnected: false,
  storeCredentialsLiveVerified: false,
};

const ANDROID_APP: FixtureApp = {
  id: 'app-android',
  name: 'Aurora Android',
  platform: 'ANDROID',
  bundleId: null,
  packageName: 'com.example.aurora',
  publicSdkKey: 'mp_pub_android',
  storeConnected: false,
  storeCredentialsLiveVerified: false,
};

/**
 * Stateful in-memory mock of the apps list + PUT/DELETE store-credentials endpoints for one test —
 * mirrors `rc-customer-detail.test.tsx`'s `mockCustomerDetail`. The default PUT marks the app
 * connected + live-verified (returns `liveVerified: true`); tests needing the pending / 422 / 503
 * branches register a later `http.put` override (later `server.use` wins). GET reads the current
 * state so a connect/disconnect is visible on the apps-list refetch the E6 hooks trigger.
 */
function mockStoreCredentials(seed: FixtureApp[]) {
  const apps = seed.map((app) => ({ ...app }));

  server.use(
    http.get(`${catalogBase}/apps`, () => HttpResponse.json(apps)),
    http.put(`${catalogBase}/apps/:appId/store-credentials`, ({ params }) => {
      const app = apps.find((candidate) => candidate.id === params.appId);
      if (!app) return problem(404, 'App not found');
      app.storeConnected = true;
      app.storeCredentialsLiveVerified = true;
      return HttpResponse.json({
        connected: true,
        platform: app.platform,
        liveVerified: true,
        verifiedAt: '2026-07-25T00:00:00.000Z',
      });
    }),
    http.delete(`${catalogBase}/apps/:appId/store-credentials`, ({ params }) => {
      const app = apps.find((candidate) => candidate.id === params.appId);
      if (app) {
        app.storeConnected = false;
        app.storeCredentialsLiveVerified = false;
      }
      return new HttpResponse(null, { status: 204 });
    }),
  );

  return apps;
}

function signInOwner() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

function signInViewer() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
  server.use(
    http.get('/api/v1/projects', () =>
      HttpResponse.json({ projects: [{ ...TEST_PROJECT, role: 'viewer' }] }),
    ),
  );
}

/** Scope assertions to one app's row (the list is a `<ul>`, not a table, so there's no `<tr>`). */
function row(appId: string): HTMLElement {
  const rowEl = document.querySelector(`[data-app-row="${appId}"]`);
  if (!rowEl) throw new Error(`row for ${appId} not found`);
  return rowEl as HTMLElement;
}

describe('RcSettingsPage — store connections', () => {
  it('renders each app with its platform and store-connection status', async () => {
    signInOwner();
    mockStoreCredentials([
      { ...IOS_APP, storeConnected: true, storeCredentialsLiveVerified: true },
      { ...ANDROID_APP },
    ]);
    renderApp(SETTINGS_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('heading', { name: 'Integration settings' })).toBeInTheDocument();
    await main.findByText('Aurora iOS');

    const iosRow = within(row(IOS_APP.id));
    expect(iosRow.getByText('iOS')).toBeInTheDocument();
    expect(iosRow.getByText('Connected')).toBeInTheDocument();

    const androidRow = within(row(ANDROID_APP.id));
    expect(androidRow.getByText('Android')).toBeInTheDocument();
    expect(androidRow.getByText('Not connected')).toBeInTheDocument();
    expect(androidRow.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('renders the live-verify pending status for a connected-but-unverified app', async () => {
    signInOwner();
    mockStoreCredentials([{ ...ANDROID_APP, storeConnected: true, storeCredentialsLiveVerified: false }]);
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora Android');

    const androidRow = within(row(ANDROID_APP.id));
    expect(androidRow.getByText('Connected · live-verify pending')).toBeInTheDocument();
    expect(androidRow.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
    expect(androidRow.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('no longer renders the legacy RevenueCat integration card', async () => {
    signInOwner();
    mockStoreCredentials([{ ...IOS_APP }]);
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora iOS');
    expect(screen.queryByTestId('rc-integration-card')).not.toBeInTheDocument();
  });

  it('shows an empty state with a New app action when the project has no apps (admin)', async () => {
    signInOwner();
    mockStoreCredentials([]);
    renderApp(SETTINGS_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('No apps yet')).toBeInTheDocument();
    expect(main.getByRole('button', { name: 'New app' })).toBeInTheDocument();
  });

  it('offers New app in the header when apps already exist (admin)', async () => {
    signInOwner();
    mockStoreCredentials([{ ...IOS_APP }]);
    renderApp(SETTINGS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('Aurora iOS');
    expect(main.getByRole('button', { name: 'New app' })).toBeInTheDocument();
  });

  it('hides the New app action from viewers', async () => {
    signInViewer();
    mockStoreCredentials([]);
    renderApp(SETTINGS_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('No apps yet')).toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'New app' })).not.toBeInTheDocument();
  });

  it('creates an app from the settings page and shows it in the list', async () => {
    signInOwner();
    const apps = mockStoreCredentials([]);
    server.use(
      http.post(`${catalogBase}/apps`, async ({ request }) => {
        const body = (await request.json()) as {
          name: string;
          platform: string;
          bundleId?: string;
          packageName?: string;
        };
        const created: FixtureApp = {
          id: 'app-new',
          name: body.name,
          platform: body.platform,
          bundleId: body.bundleId ?? null,
          packageName: body.packageName ?? null,
          publicSdkKey: 'mp_pub_new',
          storeConnected: false,
          storeCredentialsLiveVerified: false,
        };
        apps.push(created);
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    renderApp(SETTINGS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('No apps yet');

    await userEvent.click(main.getByRole('button', { name: 'New app' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Name'), 'Nova iOS');
    // Platform defaults to IOS, so the Bundle ID field is required.
    await userEvent.type(dialog.getByLabelText('Bundle ID'), 'com.example.nova');
    await userEvent.click(dialog.getByRole('button', { name: 'Create app' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main.findByText('Nova iOS')).toBeInTheDocument();
  });

  it('connects Google Play: paste JSON, submit, success toast, row becomes Connected', async () => {
    signInOwner();
    mockStoreCredentials([{ ...ANDROID_APP }]);
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora Android');

    await userEvent.click(within(row(ANDROID_APP.id)).getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Connect Google Play')).toBeInTheDocument();
    await userEvent.type(dialog.getByLabelText('Service account JSON'), 'service-account-json-here');
    await userEvent.click(dialog.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Store connected')).toBeInTheDocument();
    await waitFor(() => expect(within(row(ANDROID_APP.id)).getByText('Connected')).toBeInTheDocument());
  });

  it('connects the App Store: pending live-verify → pending toast + pending status', async () => {
    signInOwner();
    const apps = mockStoreCredentials([{ ...IOS_APP }]);
    // Creds-gated live validation unavailable → connected but pending (design §0/§1.3).
    server.use(
      http.put(`${catalogBase}/apps/:appId/store-credentials`, ({ params }) => {
        const app = apps.find((candidate) => candidate.id === params.appId);
        if (!app) return problem(404, 'App not found');
        app.storeConnected = true;
        app.storeCredentialsLiveVerified = false;
        return HttpResponse.json({
          connected: true,
          platform: app.platform,
          liveVerified: false,
          verifiedAt: null,
        });
      }),
    );
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora iOS');

    await userEvent.click(within(row(IOS_APP.id)).getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Connect App Store')).toBeInTheDocument();
    expect(dialog.getByLabelText('Bundle ID')).toHaveValue('com.example.aurora');
    await userEvent.type(dialog.getByLabelText('Issuer ID'), '57246542-0000-1111-2222-333344445555');
    await userEvent.type(dialog.getByLabelText('Key ID'), 'ABCDE12345');
    await userEvent.type(dialog.getByLabelText('App Store Connect app ID'), '1234567890');
    await userEvent.type(dialog.getByLabelText('.p8 private key'), 'p8-key-material');
    await userEvent.click(dialog.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Connected — live verification pending')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(row(IOS_APP.id)).getByText('Connected · live-verify pending')).toBeInTheDocument(),
    );
  });

  it('shows structural 422 field errors inline and keeps the dialog open', async () => {
    signInOwner();
    mockStoreCredentials([{ ...ANDROID_APP }]);
    server.use(
      http.put(`${catalogBase}/apps/:appId/store-credentials`, () =>
        problem(422, 'Validation failed', {
          errors: { serviceAccountJson: ['serviceAccountJson is not valid service-account JSON'] },
        }),
      ),
    );
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora Android');

    await userEvent.click(within(row(ANDROID_APP.id)).getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Service account JSON'), 'not json');
    await userEvent.click(dialog.getByRole('button', { name: 'Connect' }));

    expect(
      await dialog.findByText('serviceAccountJson is not valid service-account JSON'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(row(ANDROID_APP.id)).getByText('Not connected')).toBeInTheDocument();
  });

  it('shows the enc-key hint on a 503 and keeps the dialog open', async () => {
    signInOwner();
    mockStoreCredentials([{ ...ANDROID_APP }]);
    server.use(
      http.put(`${catalogBase}/apps/:appId/store-credentials`, () =>
        problem(503, 'Store credentials encryption key not configured'),
      ),
    );
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora Android');

    await userEvent.click(within(row(ANDROID_APP.id)).getByRole('button', { name: 'Connect' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Service account JSON'), 'json');
    await userEvent.click(dialog.getByRole('button', { name: 'Connect' }));

    expect(
      await dialog.findByText('Set STORE_CREDENTIALS_ENC_KEY on the server first.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders read-only for a viewer: status visible, no connect/manage/disconnect controls', async () => {
    signInViewer();
    mockStoreCredentials([{ ...IOS_APP, storeConnected: true, storeCredentialsLiveVerified: true }]);
    renderApp(SETTINGS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('Aurora iOS');

    expect(within(row(IOS_APP.id)).getByText('Connected')).toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });

  it('disconnects a connected app after confirming: DELETE, toast, row becomes Not connected', async () => {
    signInOwner();
    mockStoreCredentials([{ ...IOS_APP, storeConnected: true, storeCredentialsLiveVerified: true }]);
    renderApp(SETTINGS_URL);
    await screen.findByText('Aurora iOS');

    await userEvent.click(within(row(IOS_APP.id)).getByRole('button', { name: 'Disconnect' }));
    const alert = within(await screen.findByRole('alertdialog'));
    expect(alert.getByText('Disconnect Aurora iOS?')).toBeInTheDocument();
    await userEvent.click(alert.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Store disconnected')).toBeInTheDocument();
    await waitFor(() => expect(within(row(IOS_APP.id)).getByText('Not connected')).toBeInTheDocument());
  });
});
