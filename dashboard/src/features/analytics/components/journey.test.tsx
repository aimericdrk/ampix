import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  projectsHandlerWithoutRc,
  SUBSCRIPTION_JOURNEY_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

const JOURNEY_URL = `/projects/${TEST_PROJECT.id}/journey`;

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('JourneyPage', () => {
  it('leads with both cohort sizes and states what each one is', async () => {
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));

    // The comparison is the point, so the control's size is as prominent as the cohort's.
    expect(await main.findByText('Subscribed in range')).toBeInTheDocument();
    expect(main.getByText('128')).toBeInTheDocument();
    expect(main.getByText('Control cohort')).toBeInTheDocument();
    expect(main.getByText('512')).toBeInTheDocument();

    // The cohort definitions are on the page, not buried in a tooltip.
    expect(
      main.getByText(/first \$rc_initial_purchase falls in the selected range/),
    ).toBeInTheDocument();
    expect(main.getByText(/never bought/)).toBeInTheDocument();
  });

  it('shows each summary metric against the control, with its lift', async () => {
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('Events before')).toBeInTheDocument();
    expect(main.getByText(/23\s+\(12–41\)/)).toBeInTheDocument();
    expect(main.getByText(/9\s+\(4–15\)/)).toBeInTheDocument();
    expect(main.getByText(/2\.6×/)).toBeInTheDocument();
  });

  it('renders a metric with no control side as an em dash, never as a zero', async () => {
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));
    // days_to_outcome has no control anchor; showing 0 would read as "they took no time".
    const row = (await main.findByText('Time to outcome')).closest('tr')!;
    expect(within(row).getByText(/4\.2d/)).toBeInTheDocument();
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders the path oldest-first, ending at the outcome, with each step share', async () => {
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));
    const list = (await main.findByText('paywall_viewed', { selector: 'span' })).closest('ol')!;
    const steps = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');

    expect(steps[0]).toContain('browse_catalog');
    expect(steps[1]).toContain('$screen_view');
    expect(steps[1]).toContain('/pay'); // a screen view keeps its screen
    expect(steps[2]).toContain('paywall_viewed');
    expect(steps[3]).toContain('Subscribed'); // the outcome closes the path
    expect(steps[2]).toContain('74.2%');
  });

  it('compares per-user frequency and reports an undefined lift as a dash', async () => {
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));
    const row = (await main.findByText('promo_code_entered')).closest('tr')!;
    expect(within(row).getByText(/0\.60/)).toBeInTheDocument();
    // The control never does this, so the ratio is undefined — not Infinity, not a big number.
    expect(within(row).getByText('—')).toBeInTheDocument();

    const paywall = main.getByText('paywall_viewed', { selector: 'td' }).closest('tr')!;
    expect(within(paywall).getByText(/8\.0×/)).toBeInTheDocument();
  });

  it('warns when a cohort is too thin to conclude from', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/metrics/subscriptions/journey', () =>
        HttpResponse.json({
          ...SUBSCRIPTION_JOURNEY_FIXTURE,
          cohort: { users: 6 },
          control: { users: 512 },
        }),
      ),
    );
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText(/as likely to be chance as signal/)).toBeInTheDocument();
  });

  it('refetches for the refund outcome when the toggle moves', async () => {
    const requested: string[] = [];
    server.use(
      http.get('/api/v1/projects/:projectId/metrics/subscriptions/journey', ({ request }) => {
        const outcome = new URL(request.url).searchParams.get('outcome') ?? '';
        requested.push(outcome);
        return HttpResponse.json({
          ...SUBSCRIPTION_JOURNEY_FIXTURE,
          definition: { ...SUBSCRIPTION_JOURNEY_FIXTURE.definition, outcome },
        });
      }),
    );
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('Subscribed in range');

    await userEvent.click(screen.getByRole('radio', { name: 'Before refunding' }));

    expect(await main.findByText('Refunded in range')).toBeInTheDocument();
    expect(requested).toContain('refund');
  });

  it('sends the chosen look-back window to the API', async () => {
    const windows: Array<string | null> = [];
    server.use(
      http.get('/api/v1/projects/:projectId/metrics/subscriptions/journey', ({ request }) => {
        windows.push(new URL(request.url).searchParams.get('window_days'));
        return HttpResponse.json(SUBSCRIPTION_JOURNEY_FIXTURE);
      }),
    );
    signIn();
    renderApp(JOURNEY_URL);
    await screen.findByText('Subscribed in range');
    expect(windows[0]).toBe('7');

    await userEvent.click(screen.getByRole('radio', { name: '30d' }));
    await screen.findByText('Subscribed in range');
    expect(windows).toContain('30');
  });

  it('lives under MyAmpix and renders with no MyRevenueCat integration configured', async () => {
    // projectsHandlerWithoutRc reports integrations.revenuecat = false. The page reads the event
    // stream, so it must render anyway — that is the whole reason it moved out of the clone.
    server.use(projectsHandlerWithoutRc());
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('Subscribed in range')).toBeInTheDocument();
    expect(main.getByText('128')).toBeInTheDocument();
  });

  it('offers the renew outcome and asks the API for it', async () => {
    const requested: string[] = [];
    server.use(
      http.get('/api/v1/projects/:projectId/metrics/subscriptions/journey', ({ request }) => {
        const outcome = new URL(request.url).searchParams.get('outcome') ?? '';
        requested.push(outcome);
        return HttpResponse.json({
          ...SUBSCRIPTION_JOURNEY_FIXTURE,
          definition: { ...SUBSCRIPTION_JOURNEY_FIXTURE.definition, outcome },
        });
      }),
    );
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('Subscribed in range');

    await userEvent.click(screen.getByRole('radio', { name: 'Before renewing' }));

    expect(await main.findByText('Renewed in range')).toBeInTheDocument();
    expect(requested).toContain('renew');
  });

  it('names which subscription the outcome was for', async () => {
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('Which subscription they bought')).toBeInTheDocument();
    const row = main.getByText('pro_annual').closest('tr')!;
    expect(within(row).getByText('NORMAL')).toBeInTheDocument();
    expect(within(row).getByText('70.3%')).toBeInTheDocument();
    // A webhook with no product id is shown as "not set", not dropped.
    expect(main.getByText('not set')).toBeInTheDocument();
  });

  it('explains itself instead of showing empty tables when no webhook events have arrived', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/metrics/subscriptions/journey', () =>
        HttpResponse.json({
          ...SUBSCRIPTION_JOURNEY_FIXTURE,
          cohort: { users: 0 },
          control: { users: 0 },
          summary: [],
          path: [],
          frequency: [],
          screens: [],
          products: [],
        }),
      ),
    );
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('No RevenueCat events yet')).toBeInTheDocument();
    expect(main.getByText(/\$rc_initial_purchase/)).toBeInTheDocument();
  });

  describe('AI analysis', () => {
    it('does not call the model until asked', async () => {
      let calls = 0;
      server.use(
        http.post('/api/v1/projects/:projectId/metrics/subscriptions/journey/analyze', () => {
          calls += 1;
          return HttpResponse.json({});
        }),
      );
      signIn();
      renderApp(JOURNEY_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText('Subscribed in range');
      // An AI call costs money; it must never fire on render or refocus.
      expect(calls).toBe(0);
      expect(main.getByText(/Nothing analysed yet/)).toBeInTheDocument();
    });

    it('renders the findings with the evidence each one rests on', async () => {
      signIn();
      renderApp(JOURNEY_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText('Subscribed in range');

      await userEvent.click(main.getByRole('button', { name: /Analyse/ }));

      expect(
        await main.findByText(/Subscribers reach the paywall eight times as often/),
      ).toBeInTheDocument();
      expect(main.getByText('Paywall exposure is the separator')).toBeInTheDocument();
      // The figures behind the claim are printed beside it, so a reader can check it.
      expect(main.getByText('paywall_viewed 2.4/user vs 0.3/user')).toBeInTheDocument();
      expect(main.getByText('Both cohorts are large enough to compare.')).toBeInTheDocument();
    });

    it('surfaces a friendly message when AI analysis is not configured', async () => {
      server.use(
        http.post('/api/v1/projects/:projectId/metrics/subscriptions/journey/analyze', () =>
          HttpResponse.json(
            { type: 'about:blank', title: 'Service Unavailable', status: 503, detail: 'x' },
            { status: 503, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
      );
      signIn();
      renderApp(JOURNEY_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText('Subscribed in range');

      await userEvent.click(main.getByRole('button', { name: /Analyse/ }));

      expect(await screen.findByText(/AI analysis isn't set up/)).toBeInTheDocument();
    });
  });

  it('hands the exact report payload to the clipboard for an outside AI', async () => {
    const writeText = vi.fn(async (text: string) => void text);
    Object.assign(navigator, { clipboard: { writeText } });
    signIn();
    renderApp(JOURNEY_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('Subscribed in range');

    await userEvent.click(main.getByRole('button', { name: 'Copy JSON' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = JSON.parse(writeText.mock.calls[0]![0]);
    // Self-describing: whatever reads this gets the units and cohort definitions with the numbers.
    expect(copied.definition.outcome_criteria).toBeTruthy();
    expect(copied.definition.control_criteria).toBeTruthy();
    expect(copied.cohort.users).toBe(128);
    expect(copied.summary[0].unit).toBe('events');
  });
});
