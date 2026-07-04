import type { AuthRequest } from '../auth/auth.types';
import { AnalyticsController } from './analytics.controller';
import type { AnalyticsService } from './analytics.service';

const USER = { id: 'user-1', email: 'a@b.com', name: 'A' };

function fakeRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return { headers: {}, user: USER, ...overrides } as unknown as AuthRequest;
}

function makeController() {
  const analytics = {
    runInsightsQuery: jest.fn(),
    listEventNames: jest.fn(),
    listProperties: jest.fn(),
    getLiveEvents: jest.fn(),
    listUsers: jest.fn(),
    getUserProfile: jest.fn(),
    getSessionsSummary: jest.fn(),
  };
  const controller = new AnalyticsController(analytics as unknown as AnalyticsService);
  return { controller, analytics };
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

  describe('eventsLive', () => {
    it('delegates to the service with the caller id, projectId, limit, and before', async () => {
      const { controller, analytics } = makeController();
      const response = { events: [], next_before: null };
      analytics.getLiveEvents.mockResolvedValue(response);

      const result = await controller.eventsLive(fakeRequest(), 'p1', '50', '2026-06-01T00:00:00Z');

      expect(analytics.getLiveEvents).toHaveBeenCalledWith(
        USER.id,
        'p1',
        '50',
        '2026-06-01T00:00:00Z',
      );
      expect(result).toEqual(response);
    });

    it('works with no query params at all', async () => {
      const { controller, analytics } = makeController();
      analytics.getLiveEvents.mockResolvedValue({ events: [], next_before: null });

      await controller.eventsLive(fakeRequest(), 'p1', undefined, undefined);

      expect(analytics.getLiveEvents).toHaveBeenCalledWith(USER.id, 'p1', undefined, undefined);
    });
  });

  describe('users', () => {
    it('delegates to the service with the caller id, projectId, search, limit, and cursor', async () => {
      const { controller, analytics } = makeController();
      const response = { users: [], next_cursor: null };
      analytics.listUsers.mockResolvedValue(response);

      const result = await controller.users(fakeRequest(), 'p1', 'alice', '20', 'u5');

      expect(analytics.listUsers).toHaveBeenCalledWith(USER.id, 'p1', 'alice', '20', 'u5');
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
      );

      expect(analytics.getSessionsSummary).toHaveBeenCalledWith(
        USER.id,
        'p1',
        '2026-06-01',
        '2026-06-02',
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

      await controller.sessionsSummary(fakeRequest(), 'p1', undefined, undefined);

      expect(analytics.getSessionsSummary).toHaveBeenCalledWith(
        USER.id,
        'p1',
        undefined,
        undefined,
      );
    });
  });
});
