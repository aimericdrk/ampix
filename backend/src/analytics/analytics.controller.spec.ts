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
});
