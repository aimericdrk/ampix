import type { AuthRequest } from '../../auth/auth.types';
import { AiRequestError, AiUnconfiguredError } from '../ai/mistral.service';
import type { MistralService } from '../ai/mistral.service';
import { AnalyticsController } from './analytics.controller';
import type { AnalyticsService } from '../services/analytics.service';
import type { UserAdminService } from '../services/user-admin.service';
import type { AttributionService } from '../queries/attribution/attribution.service';
import type { ExperimentsService } from '../queries/experiments/experiments.service';

const USER = { id: 'user-1', email: 'a@b.com', name: 'A' };

function fakeRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return { headers: {}, user: USER, ...overrides } as unknown as AuthRequest;
}

function makeController() {
  const analytics = {
    runInsightsQuery: jest.fn(),
    listEventNames: jest.fn(),
    listProperties: jest.fn(),
    listPropertyValues: jest.fn(),
    getLiveEvents: jest.fn(),
    listUsers: jest.fn(),
    getUserProfile: jest.fn(),
    getSessionsSummary: jest.fn(),
    getRevenueSummary: jest.fn(),
  };
  const mistral = {
    translateToInsights: jest.fn(),
  };
  const userAdmin = {
    listHiddenUsers: jest.fn(),
    hideUser: jest.fn(),
    unhideUser: jest.fn(),
    eraseUser: jest.fn(),
    deleteUserEvent: jest.fn(),
  };
  const attribution = { getAttribution: jest.fn() };
  const experiments = { runExperimentQuery: jest.fn() };
  const controller = new AnalyticsController(
    analytics as unknown as AnalyticsService,
    mistral as unknown as MistralService,
    userAdmin as unknown as UserAdminService,
    attribution as unknown as AttributionService,
    experiments as unknown as ExperimentsService,
  );
  return { controller, analytics, mistral, userAdmin, attribution, experiments };
}

describe('AnalyticsController', () => {
  describe('insights', () => {
    it('delegates to the service with the caller id, path param projectId, and raw body', async () => {
      const { controller, analytics } = makeController();
      const response = { series: [] };
      analytics.runInsightsQuery.mockResolvedValue(response);
      const body = { events: [{ name: 'checkout_completed', aggregation: 'total' }] };

      const result = await controller.insights(fakeRequest(), 'p1', body);

      expect(analytics.runInsightsQuery).toHaveBeenCalledWith(USER.id, 'p1', body);
      expect(result).toEqual(response);
    });

    it('propagates a ProblemException (e.g. 400 from validation) thrown by the service', async () => {
      const { controller, analytics } = makeController();
      analytics.runInsightsQuery.mockRejectedValue(
        Object.assign(new Error('bad'), { problem: { status: 400 } }),
      );

      await expect(controller.insights(fakeRequest(), 'p1', {})).rejects.toMatchObject({
        problem: { status: 400 },
      });
    });
  });

  describe('metaEvents', () => {
    it('delegates to the service with the caller id and path param projectId', async () => {
      const { controller, analytics } = makeController();
      analytics.listEventNames.mockResolvedValue({ events: ['checkout_completed'] });

      const result = await controller.metaEvents(fakeRequest(), 'p1');

      expect(analytics.listEventNames).toHaveBeenCalledWith(USER.id, 'p1');
      expect(result).toEqual({ events: ['checkout_completed'] });
    });
  });

  describe('metaProperties', () => {
    it('delegates to the service, forwarding the optional `event` query param', async () => {
      const { controller, analytics } = makeController();
      analytics.listProperties.mockResolvedValue({ properties: [] });

      await controller.metaProperties(fakeRequest(), 'p1', 'checkout_completed');

      expect(analytics.listProperties).toHaveBeenCalledWith(USER.id, 'p1', 'checkout_completed');
    });

    it('works with no `event` query param at all', async () => {
      const { controller, analytics } = makeController();
      analytics.listProperties.mockResolvedValue({ properties: [] });

      await controller.metaProperties(fakeRequest(), 'p1', undefined);

      expect(analytics.listProperties).toHaveBeenCalledWith(USER.id, 'p1', undefined);
    });
  });

  describe('metaPropertyValues', () => {
    it('delegates to the service, forwarding property, event, and limit query params', async () => {
      const { controller, analytics } = makeController();
      analytics.listPropertyValues.mockResolvedValue({ values: ['free', 'pro'] });

      const result = await controller.metaPropertyValues(
        fakeRequest(),
        'p1',
        'plan',
        'checkout',
        '25',
      );

      expect(analytics.listPropertyValues).toHaveBeenCalledWith(
        USER.id,
        'p1',
        'plan',
        'checkout',
        '25',
      );
      expect(result).toEqual({ values: ['free', 'pro'] });
    });

    it('works with only `property` given (event and limit undefined)', async () => {
      const { controller, analytics } = makeController();
      analytics.listPropertyValues.mockResolvedValue({ values: [] });

      await controller.metaPropertyValues(fakeRequest(), 'p1', 'plan', undefined, undefined);

      expect(analytics.listPropertyValues).toHaveBeenCalledWith(
        USER.id,
        'p1',
        'plan',
        undefined,
        undefined,
      );
    });
  });

  describe('eventsLive', () => {
    it('delegates to the service with the caller id, projectId, limit, before, and source', async () => {
      const { controller, analytics } = makeController();
      const response = { events: [], next_before: null };
      analytics.getLiveEvents.mockResolvedValue(response);

      const result = await controller.eventsLive(
        fakeRequest(),
        'p1',
        '50',
        '2026-06-01T00:00:00Z',
        'server',
      );

      expect(analytics.getLiveEvents).toHaveBeenCalledWith(
        USER.id,
        'p1',
        '50',
        '2026-06-01T00:00:00Z',
        'server',
      );
      expect(result).toEqual(response);
    });

    it('works with no query params at all', async () => {
      const { controller, analytics } = makeController();
      analytics.getLiveEvents.mockResolvedValue({ events: [], next_before: null });

      await controller.eventsLive(fakeRequest(), 'p1', undefined, undefined);

      expect(analytics.getLiveEvents).toHaveBeenCalledWith(
        USER.id,
        'p1',
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('users', () => {
    it('delegates to the service with the caller id, projectId, search, limit, and cursor', async () => {
      const { controller, analytics } = makeController();
      const response = { users: [], next_cursor: null };
      analytics.listUsers.mockResolvedValue(response);

      const result = await controller.users(fakeRequest(), 'p1', 'alice', '20', 'u5');

      expect(analytics.listUsers).toHaveBeenCalledWith(
        USER.id,
        'p1',
        'alice',
        '20',
        'u5',
        undefined,
        undefined,
      );
      expect(result).toEqual(response);
    });
  });

  describe('userProfile', () => {
    it('delegates to the service with the caller id, projectId, and distinctId path param', async () => {
      const { controller, analytics } = makeController();
      const response = {
        distinct_id: 'u1',
        profile: {},
        first_seen: null,
        last_seen: null,
        event_count: 0,
        recent_events: [],
      };
      analytics.getUserProfile.mockResolvedValue(response);

      const result = await controller.userProfile(fakeRequest(), 'p1', 'u1');

      expect(analytics.getUserProfile).toHaveBeenCalledWith(USER.id, 'p1', 'u1');
      expect(result).toEqual(response);
    });
  });

  describe('deleteUserEvent', () => {
    it('delegates to the user-admin service with the caller, project, user and event ids', async () => {
      const { controller, userAdmin } = makeController();
      const response = {
        insert_id: '018f6b2e-0000-7000-8000-0000000000ff',
        event: 'checkout_completed',
        timestamp: '2026-08-01T10:00:00.000Z',
      };
      userAdmin.deleteUserEvent.mockResolvedValue(response);

      const result = await controller.deleteUserEvent(
        fakeRequest(),
        'p1',
        'u1',
        '018f6b2e-0000-7000-8000-0000000000ff',
      );

      expect(userAdmin.deleteUserEvent).toHaveBeenCalledWith(
        USER.id,
        'p1',
        'u1',
        '018f6b2e-0000-7000-8000-0000000000ff',
      );
      expect(result).toEqual(response);
    });
  });

  describe('sessionsSummary', () => {
    it('delegates to the service with the caller id, projectId, from, and to', async () => {
      const { controller, analytics } = makeController();
      const response = { sessions: 0, avg_duration_ms: 0, by_day: [] };
      analytics.getSessionsSummary.mockResolvedValue(response);

      const result = await controller.sessionsSummary(
        fakeRequest(),
        'p1',
        '2026-06-01',
        '2026-06-02',
        undefined,
      );

      expect(analytics.getSessionsSummary).toHaveBeenCalledWith(
        USER.id,
        'p1',
        '2026-06-01',
        '2026-06-02',
        undefined,
      );
      expect(result).toEqual(response);
    });

    it('works with no from/to query params at all', async () => {
      const { controller, analytics } = makeController();
      analytics.getSessionsSummary.mockResolvedValue({
        sessions: 0,
        avg_duration_ms: 0,
        by_day: [],
      });

      await controller.sessionsSummary(fakeRequest(), 'p1', undefined, undefined, undefined);

      expect(analytics.getSessionsSummary).toHaveBeenCalledWith(
        USER.id,
        'p1',
        undefined,
        undefined,
        undefined,
      );
    });

    it('passes an encoded filters param through to the service (feat-02 §3.4/T2)', async () => {
      const { controller, analytics } = makeController();
      analytics.getSessionsSummary.mockResolvedValue({
        sessions: 0,
        avg_duration_ms: 0,
        by_day: [],
      });
      const encoded = 'eyJwcm9wZXJ0eSI6Im9zIn0';

      await controller.sessionsSummary(
        fakeRequest(),
        'p1',
        '2026-06-01',
        '2026-06-02',
        encoded,
      );

      expect(analytics.getSessionsSummary).toHaveBeenCalledWith(
        USER.id,
        'p1',
        '2026-06-01',
        '2026-06-02',
        encoded,
      );
    });
  });

  describe('revenueSummary', () => {
    it('delegates to the service with the caller id, projectId, from, and to', async () => {
      const { controller, analytics } = makeController();
      const response = {
        total_revenue: 0,
        purchases: 0,
        paying_users: 0,
        arppu: 0,
        avg_purchase_value: 0,
        by_day: [],
        by_product: [],
      };
      analytics.getRevenueSummary.mockResolvedValue(response);

      const result = await controller.revenueSummary(
        fakeRequest(),
        'p1',
        '2026-06-01',
        '2026-06-02',
        undefined,
      );

      expect(analytics.getRevenueSummary).toHaveBeenCalledWith(
        USER.id,
        'p1',
        '2026-06-01',
        '2026-06-02',
        undefined,
      );
      expect(result).toEqual(response);
    });

    it('works with no from/to query params at all', async () => {
      const { controller, analytics } = makeController();
      analytics.getRevenueSummary.mockResolvedValue({
        total_revenue: 0,
        purchases: 0,
        paying_users: 0,
        arppu: 0,
        avg_purchase_value: 0,
        by_day: [],
        by_product: [],
      });

      await controller.revenueSummary(fakeRequest(), 'p1', undefined, undefined, undefined);

      expect(analytics.getRevenueSummary).toHaveBeenCalledWith(
        USER.id,
        'p1',
        undefined,
        undefined,
        undefined,
      );
    });

    it('passes an encoded filters param through to the service (feat-02 §3.4/T2)', async () => {
      const { controller, analytics } = makeController();
      analytics.getRevenueSummary.mockResolvedValue({
        total_revenue: 0,
        purchases: 0,
        paying_users: 0,
        arppu: 0,
        avg_purchase_value: 0,
        by_day: [],
        by_product: [],
      });
      const encoded = 'eyJwcm9wZXJ0eSI6Im9zIn0';

      await controller.revenueSummary(fakeRequest(), 'p1', '2026-06-01', '2026-06-02', encoded);

      expect(analytics.getRevenueSummary).toHaveBeenCalledWith(
        USER.id,
        'p1',
        '2026-06-01',
        '2026-06-02',
        encoded,
      );
    });
  });

  describe('ask (feat-17 §3.1 — "Ask your data")', () => {
    const validDefinition = {
      events: [{ name: 'checkout_completed', aggregation: 'total' }],
      date_range: { from: '2026-06-01', to: '2026-07-01' },
      interval: 'day',
      filters: [],
    };

    function mockMetadata(analytics: ReturnType<typeof makeController>['analytics']) {
      analytics.listEventNames.mockResolvedValue({ events: ['checkout_completed', 'app_open'] });
      analytics.listProperties.mockResolvedValue({
        properties: [
          { name: 'os', type: 'column' },
          { name: 'utm_source', type: 'string' },
        ],
      });
    }

    it('gathers event/property metadata as context, translates via Mistral, and returns the validated definition', async () => {
      const { controller, analytics, mistral } = makeController();
      mockMetadata(analytics);
      mistral.translateToInsights.mockResolvedValue(validDefinition);

      const result = await controller.ask(fakeRequest(), 'p1', {
        question: 'conversions this month',
      });

      expect(analytics.listEventNames).toHaveBeenCalledWith(USER.id, 'p1');
      expect(analytics.listProperties).toHaveBeenCalledWith(USER.id, 'p1');
      expect(mistral.translateToInsights).toHaveBeenCalledWith('conversions this month', {
        events: ['checkout_completed', 'app_open'],
        properties: ['os', 'utm_source'],
      });
      expect(result).toEqual({ question: 'conversions this month', definition: validDefinition });
    });

    it('never runs the raw model output through the query engine', async () => {
      const { controller, analytics, mistral } = makeController();
      mockMetadata(analytics);
      mistral.translateToInsights.mockResolvedValue(validDefinition);

      await controller.ask(fakeRequest(), 'p1', { question: 'conversions this month' });

      expect(analytics.runInsightsQuery).not.toHaveBeenCalled();
    });

    it('rejects a malformed question body with a 400', async () => {
      const { controller, analytics, mistral } = makeController();
      mockMetadata(analytics);

      await expect(controller.ask(fakeRequest(), 'p1', { question: '' })).rejects.toMatchObject({
        problem: { status: 400 },
      });
      await expect(
        controller.ask(fakeRequest(), 'p1', { question: 'x'.repeat(501) }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(mistral.translateToInsights).not.toHaveBeenCalled();
    });

    it('maps an unconfigured Mistral service (no API key) to a 503', async () => {
      const { controller, analytics, mistral } = makeController();
      mockMetadata(analytics);
      mistral.translateToInsights.mockRejectedValue(new AiUnconfiguredError());

      await expect(
        controller.ask(fakeRequest(), 'p1', { question: 'daily active users' }),
      ).rejects.toMatchObject({
        problem: { status: 503, title: 'AI query is not configured' },
      });
    });

    it('maps a garbage/invalid model output (fails insightsQuerySchema) to a 422', async () => {
      const { controller, analytics, mistral } = makeController();
      mockMetadata(analytics);
      mistral.translateToInsights.mockResolvedValue({ not: 'a valid definition' });

      await expect(
        controller.ask(fakeRequest(), 'p1', { question: 'daily active users' }),
      ).rejects.toMatchObject({
        problem: { status: 422, title: 'Could not turn that into a query' },
      });
      expect(analytics.runInsightsQuery).not.toHaveBeenCalled();
    });

    it('maps non-JSON prose output to a 422 as well', async () => {
      const { controller, analytics, mistral } = makeController();
      mockMetadata(analytics);
      // MistralService itself throws AiRequestError for non-JSON content; simulate the schema
      // failure path here for a value that parsed as JSON but doesn't match the schema shape.
      mistral.translateToInsights.mockResolvedValue('just a string, not an object');

      await expect(
        controller.ask(fakeRequest(), 'p1', { question: 'daily active users' }),
      ).rejects.toMatchObject({ problem: { status: 422 } });
    });

    it('propagates a membership/tenancy ProblemException raised while gathering metadata', async () => {
      const { controller, analytics, mistral } = makeController();
      analytics.listEventNames.mockRejectedValue(
        Object.assign(new Error('forbidden'), { problem: { status: 403 } }),
      );
      analytics.listProperties.mockResolvedValue({ properties: [] });

      await expect(
        controller.ask(fakeRequest(), 'p1', { question: 'daily active users' }),
      ).rejects.toMatchObject({ problem: { status: 403 } });
      expect(mistral.translateToInsights).not.toHaveBeenCalled();
    });

    it('maps a Mistral transport failure to a 502', async () => {
      const { controller, analytics, mistral } = makeController();
      mockMetadata(analytics);
      mistral.translateToInsights.mockRejectedValue(new AiRequestError('boom'));

      await expect(
        controller.ask(fakeRequest(), 'p1', { question: 'daily active users' }),
      ).rejects.toMatchObject({ problem: { status: 502 } });
    });
  });
});
