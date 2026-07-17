import { UnauthorizedException } from '@nestjs/common';
import { AppleWebhookController } from './apple-webhook.controller';
import { AppleSignatureError, ApplePayloadError, type AppleNotificationVerifier, type VerifiedAppleNotification } from './apple-notification-verifier';

function decodedFixture(overrides: Partial<VerifiedAppleNotification> = {}): VerifiedAppleNotification {
  return {
    notificationType: 'SUBSCRIBED',
    subtype: 'INITIAL_BUY',
    notificationUUID: 'notification-uuid-1',
    signedDate: new Date('2026-07-15T00:00:00Z'),
    bundleId: 'com.myampix.app',
    environment: 'Sandbox',
    ...overrides,
  };
}

function makeController(verifyAndDecode: jest.Mock): AppleWebhookController {
  const verifier = { verifyAndDecode } as unknown as AppleNotificationVerifier;
  return new AppleWebhookController(verifier);
}

describe('AppleWebhookController', () => {
  it('200s with { received: true } on a valid, verified notification', async () => {
    const controller = makeController(jest.fn().mockResolvedValue(decodedFixture()));

    await expect(controller.receive({ signedPayload: 'valid-jws' })).resolves.toEqual({ received: true });
  });

  it('401s (no body needed) on AppleSignatureError', async () => {
    const controller = makeController(jest.fn().mockRejectedValue(new AppleSignatureError('bad signature')));

    await expect(controller.receive({ signedPayload: 'tampered-jws' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('400s on ApplePayloadError, carrying the reason as the problem detail', async () => {
    const controller = makeController(jest.fn().mockRejectedValue(new ApplePayloadError('missing notificationType')));

    await expect(controller.receive({ signedPayload: 'un-decodable-jws' })).rejects.toMatchObject({
      problem: { status: 400, detail: 'missing notificationType' },
    });
  });

  it('400s when signedPayload is missing', async () => {
    const controller = makeController(jest.fn());

    await expect(controller.receive({})).rejects.toMatchObject({ problem: { status: 400 } });
  });

  it('400s when signedPayload is present but not a string', async () => {
    const controller = makeController(jest.fn());

    await expect(controller.receive({ signedPayload: 12345 })).rejects.toMatchObject({ problem: { status: 400 } });
  });

  it('400s when the body itself is not an object', async () => {
    const controller = makeController(jest.fn());

    await expect(controller.receive('not-json')).rejects.toMatchObject({ problem: { status: 400 } });
  });

  it('re-throws unexpected errors from the verifier as-is (not swallowed into 400/401)', async () => {
    const controller = makeController(jest.fn().mockRejectedValue(new Error('boom')));

    await expect(controller.receive({ signedPayload: 'valid-jws' })).rejects.toThrow('boom');
  });
});
