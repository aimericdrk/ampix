import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { AuthRequest } from '../../auth/auth.types';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import { AiRequestError, AiUnconfiguredError } from '../../analytics/ai/mistral.service';
import type { MistralService } from '../../analytics/ai/mistral.service';
import { RcJourneyController } from './rc-journey.controller';
import type { RcJourneyService } from './rc-journey.service';

const USER = { id: 'user-1', email: 'a@b.com', name: 'A' };
const REPORT = { definition: { outcome: 'subscribe' }, cohort: { users: 100 } };

function fakeRequest(): AuthRequest {
  return { headers: {}, user: USER } as unknown as AuthRequest;
}

function makeController() {
  const journey = { getJourney: jest.fn(async () => REPORT) };
  const mistral = { analyzeJourney: jest.fn() };
  const controller = new RcJourneyController(
    journey as unknown as RcJourneyService,
    mistral as unknown as MistralService,
  );
  return { controller, journey, mistral };
}

const VALID_ANALYSIS = {
  headline: 'Converters see the paywall 8x as often as everyone else.',
  findings: [
    { title: 'Paywall exposure', detail: 'They reach it far more often.', evidence: ['2.4 vs 0.3'] },
  ],
  caveats: ['Control group is large enough; cohort is 100 users.'],
};

describe('RcJourneyController', () => {
  it('is JWT-guarded at class level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RcJourneyController)).toEqual([JwtAuthGuard]);
  });

  describe('subscriptionJourney', () => {
    it('defaults to the subscribe outcome and passes the range through', async () => {
      const { controller, journey } = makeController();
      await controller.subscriptionJourney(fakeRequest(), 'p1', undefined, '2026-07-01', '2026-07-10');
      expect(journey.getJourney).toHaveBeenCalledWith(
        USER.id,
        'p1',
        'subscribe',
        '2026-07-01',
        '2026-07-10',
        undefined,
        undefined,
      );
    });

    it('accepts the refund outcome', async () => {
      const { controller, journey } = makeController();
      await controller.subscriptionJourney(fakeRequest(), 'p1', 'refund');
      expect(journey.getJourney).toHaveBeenCalledWith(
        USER.id,
        'p1',
        'refund',
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('400s on an unknown outcome rather than silently measuring subscriptions', async () => {
      const { controller, journey } = makeController();
      await expect(
        controller.subscriptionJourney(fakeRequest(), 'p1', 'churn'),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(journey.getJourney).not.toHaveBeenCalled();
    });

    it.each([['abc'], ['0'], ['-3'], ['2.5']])('400s on a malformed window_days (%s)', async (raw) => {
      const { controller } = makeController();
      await expect(
        controller.subscriptionJourney(fakeRequest(), 'p1', 'subscribe', undefined, undefined, raw),
      ).rejects.toMatchObject({ problem: { status: 400 } });
    });

    it('parses window_days and path_steps into numbers for the service to clamp', async () => {
      const { controller, journey } = makeController();
      await controller.subscriptionJourney(
        fakeRequest(),
        'p1',
        'subscribe',
        undefined,
        undefined,
        '14',
        '12',
      );
      expect(journey.getJourney).toHaveBeenCalledWith(
        USER.id,
        'p1',
        'subscribe',
        undefined,
        undefined,
        14,
        12,
      );
    });
  });

  describe('analyzeSubscriptionJourney', () => {
    it('returns the findings alongside the exact report the model was given', async () => {
      const { controller, mistral } = makeController();
      mistral.analyzeJourney.mockResolvedValue(VALID_ANALYSIS);

      const result = await controller.analyzeSubscriptionJourney(fakeRequest(), 'p1', 'subscribe');

      expect(mistral.analyzeJourney).toHaveBeenCalledWith(REPORT);
      expect(result.outcome).toBe('subscribe');
      expect(result.headline).toBe(VALID_ANALYSIS.headline);
      expect(result.findings).toEqual(VALID_ANALYSIS.findings);
      // The narrative ships with its input so a reader can check it without re-running anything.
      expect(result.report).toBe(REPORT);
    });

    it('defaults absent findings/caveats to empty arrays', async () => {
      const { controller, mistral } = makeController();
      mistral.analyzeJourney.mockResolvedValue({ headline: 'Nothing stands out.' });
      const result = await controller.analyzeSubscriptionJourney(fakeRequest(), 'p1');
      expect(result.findings).toEqual([]);
      expect(result.caveats).toEqual([]);
    });

    it('503s when no Mistral key is configured — unconfigured is not a bug', async () => {
      const { controller, mistral } = makeController();
      mistral.analyzeJourney.mockRejectedValue(new AiUnconfiguredError());
      await expect(
        controller.analyzeSubscriptionJourney(fakeRequest(), 'p1'),
      ).rejects.toMatchObject({ problem: { status: 503 } });
    });

    it('502s when the provider cannot be reached', async () => {
      const { controller, mistral } = makeController();
      mistral.analyzeJourney.mockRejectedValue(new AiRequestError('boom'));
      await expect(
        controller.analyzeSubscriptionJourney(fakeRequest(), 'p1'),
      ).rejects.toMatchObject({ problem: { status: 502 } });
    });

    it('422s rather than forwarding an analysis in an unexpected shape', async () => {
      const { controller, mistral } = makeController();
      mistral.analyzeJourney.mockResolvedValue({ findings: 'not an array' });
      await expect(
        controller.analyzeSubscriptionJourney(fakeRequest(), 'p1'),
      ).rejects.toMatchObject({ problem: { status: 422 } });
    });

    it('rejects an unknown outcome before spending an AI call', async () => {
      const { controller, mistral, journey } = makeController();
      await expect(
        controller.analyzeSubscriptionJourney(fakeRequest(), 'p1', 'nonsense'),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(journey.getJourney).not.toHaveBeenCalled();
      expect(mistral.analyzeJourney).not.toHaveBeenCalled();
    });
  });
});
