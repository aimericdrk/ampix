import { UnauthorizedException } from '@nestjs/common';
import { GoogleWebhookController } from './google-webhook.controller';
import type { GooglePushAuthenticator } from './google-push-authenticator';
import type { AppsService } from '../../catalog/services/apps.service';

function toBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function pushBody(data: string, overrides: Partial<{ messageId: string; publishTime: string; subscription: string }> = {}) {
  return {
    message: {
      data,
      messageId: overrides.messageId ?? 'msg-1',
      publishTime: overrides.publishTime ?? '2026-07-17T00:00:00.000Z',
    },
    subscription: overrides.subscription ?? 'projects/myampix/subscriptions/google-rtdn-push',
  };
}

const testNotificationData = toBase64({
  version: '1.0',
  packageName: 'com.myampix.app',
  eventTimeMillis: '1721030400000',
  testNotification: { version: '1.0' },
});

function makeController(
  authenticate: jest.Mock = jest.fn().mockReturnValue(true),
  findByPackageName: jest.Mock = jest.fn().mockResolvedValue({ id: 'app-1', projectId: 'project-1' }),
): { controller: GoogleWebhookController; authenticate: jest.Mock; findByPackageName: jest.Mock } {
  const authenticator = { authenticate } as unknown as GooglePushAuthenticator;
  const apps = { findByPackageName } as unknown as AppsService;
  return { controller: new GoogleWebhookController(authenticator, apps), authenticate, findByPackageName };
}

describe('GoogleWebhookController', () => {
  it('200s with { received: true } for an authenticated, decodable notification for a known App', async () => {
    const { controller } = makeController();

    await expect(controller.receive(pushBody(testNotificationData), 'correct-token', undefined)).resolves.toEqual({
      received: true,
    });
  });

  it('200s even when the App resolves to null (unknown packageName) — the SKIPPED path is M3b, decode still succeeded', async () => {
    const { controller, findByPackageName } = makeController(jest.fn().mockReturnValue(true), jest.fn().mockResolvedValue(null));

    await expect(controller.receive(pushBody(testNotificationData), 'correct-token', undefined)).resolves.toEqual({
      received: true,
    });
    expect(findByPackageName).toHaveBeenCalledWith('com.myampix.app');
  });

  it('resolves the App by the decoded packageName', async () => {
    const { controller, findByPackageName } = makeController();

    await controller.receive(pushBody(testNotificationData), 'correct-token', undefined);

    expect(findByPackageName).toHaveBeenCalledWith('com.myampix.app');
  });

  it('passes the query token and Authorization header through to the authenticator', async () => {
    const { controller, authenticate } = makeController();

    await controller.receive(pushBody(testNotificationData), 'the-token', 'Bearer some.jwt');

    expect(authenticate).toHaveBeenCalledWith({ queryToken: 'the-token', authorizationHeader: 'Bearer some.jwt' });
  });

  it('401s when the authenticator rejects (wrong/missing token) — before any decode happens', async () => {
    const { controller, findByPackageName } = makeController(jest.fn().mockReturnValue(false));

    await expect(controller.receive(pushBody(testNotificationData), 'wrong-token', undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findByPackageName).not.toHaveBeenCalled();
  });

  it('401s when no token is provided at all', async () => {
    const { controller } = makeController(jest.fn().mockReturnValue(false));

    await expect(controller.receive(pushBody(testNotificationData), undefined, undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('400s when the body is missing message.data', async () => {
    const { controller } = makeController();

    await expect(
      controller.receive({ message: { messageId: 'm1', publishTime: '2026-07-17T00:00:00.000Z' } }, 'correct-token', undefined),
    ).rejects.toMatchObject({ problem: { status: 400 } });
  });

  it('400s when message.data is not valid base64', async () => {
    const { controller } = makeController();

    await expect(controller.receive(pushBody('not base64!! $$ %%'), 'correct-token', undefined)).rejects.toMatchObject({
      problem: { status: 400 },
    });
  });

  it('400s when message.data decodes to non-JSON', async () => {
    const { controller } = makeController();
    const notJson = Buffer.from('not json at all', 'utf8').toString('base64');

    await expect(controller.receive(pushBody(notJson), 'correct-token', undefined)).rejects.toMatchObject({
      problem: { status: 400 },
    });
  });

  it('400s when message.data decodes to JSON with no recognized sub-notification', async () => {
    const { controller } = makeController();
    const noKnownKind = toBase64({ version: '1.0', packageName: 'com.myampix.app', eventTimeMillis: '123' });

    await expect(controller.receive(pushBody(noKnownKind), 'correct-token', undefined)).rejects.toMatchObject({
      problem: { status: 400 },
    });
  });

  it('400s when the body itself is not an object', async () => {
    const { controller } = makeController();

    await expect(controller.receive('not-json', 'correct-token', undefined)).rejects.toMatchObject({
      problem: { status: 400 },
    });
  });

  it('decodes each recognized sub-notification variant and still 200s (subscription / voided / one-time)', async () => {
    const { controller } = makeController();

    const variants = [
      {
        version: '1.0',
        packageName: 'com.myampix.app',
        eventTimeMillis: '1721030400000',
        subscriptionNotification: { version: '1.0', notificationType: 4, purchaseToken: 't1', subscriptionId: 'sub1' },
      },
      {
        version: '1.0',
        packageName: 'com.myampix.app',
        eventTimeMillis: '1721030400000',
        voidedPurchaseNotification: { purchaseToken: 't1', orderId: 'GPA.1', productType: 1, refundType: 1 },
      },
      {
        version: '1.0',
        packageName: 'com.myampix.app',
        eventTimeMillis: '1721030400000',
        oneTimeProductNotification: { version: '1.0', notificationType: 1, purchaseToken: 't1', sku: 'coins' },
      },
    ];

    for (const variant of variants) {
      await expect(controller.receive(pushBody(toBase64(variant)), 'correct-token', undefined)).resolves.toEqual({
        received: true,
      });
    }
  });
});
