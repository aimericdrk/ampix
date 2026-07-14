import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { AuthRequest } from '../../auth/auth.types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RcMetricsController } from './rc-metrics.controller';
import type { RcMetricsService } from './rc-metrics.service';

const USER = { id: 'user-1', email: 'a@b.com', name: 'A' };

function fakeRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return { headers: {}, user: USER, ...overrides } as unknown as AuthRequest;
}

function makeController() {
  const rcMetrics = { getSummary: jest.fn() };
  const controller = new RcMetricsController(rcMetrics as unknown as RcMetricsService);
  return { controller, rcMetrics };
}

describe('RcMetricsController', () => {
  it('is JWT-guarded at class level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RcMetricsController)).toEqual([JwtAuthGuard]);
  });

  describe('subscriptionsSummary', () => {
    it('delegates to the service with the caller id, projectId, from, to, and filters', async () => {
      const { controller, rcMetrics } = makeController();
      const response = { active: 5 };
      rcMetrics.getSummary.mockResolvedValue(response);

      const result = await controller.subscriptionsSummary(
        fakeRequest(),
        'p1',
        '2026-06-01',
        '2026-06-02',
        undefined,
      );

      expect(rcMetrics.getSummary).toHaveBeenCalledWith(
        USER.id,
        'p1',
        '2026-06-01',
        '2026-06-02',
        undefined,
      );
      expect(result).toEqual(response);
    });

    it('works with no query params at all', async () => {
      const { controller, rcMetrics } = makeController();
      rcMetrics.getSummary.mockResolvedValue({ active: 0 });

      await controller.subscriptionsSummary(fakeRequest(), 'p1', undefined, undefined, undefined);

      expect(rcMetrics.getSummary).toHaveBeenCalledWith(
        USER.id,
        'p1',
        undefined,
        undefined,
        undefined,
      );
    });

    it('passes an encoded filters param through to the service', async () => {
      const { controller, rcMetrics } = makeController();
      rcMetrics.getSummary.mockResolvedValue({ active: 0 });
      const encoded = 'eyJwcm9wZXJ0eSI6Im9zIn0';

      await controller.subscriptionsSummary(fakeRequest(), 'p1', '2026-06-01', '2026-06-02', encoded);

      expect(rcMetrics.getSummary).toHaveBeenCalledWith(
        USER.id,
        'p1',
        '2026-06-01',
        '2026-06-02',
        encoded,
      );
    });

    it('propagates a ProblemException (e.g. 404) thrown by the service', async () => {
      const { controller, rcMetrics } = makeController();
      rcMetrics.getSummary.mockRejectedValue(
        Object.assign(new Error('not found'), { problem: { status: 404 } }),
      );

      await expect(
        controller.subscriptionsSummary(fakeRequest(), 'p1', undefined, undefined, undefined),
      ).rejects.toMatchObject({ problem: { status: 404 } });
    });
  });
});
