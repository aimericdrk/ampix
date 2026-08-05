import { ReceiptsController } from './receipts.controller';
import type { ReceiptsService } from '../services/receipts.service';
import type { RequestWithSdkApp } from '../../catalog/public-api-key.guard';
import type { CustomerInfo } from '../../entitlements/customer-info.types';

function customerInfoFixture(): CustomerInfo {
  return { entitlements: { active: {}, all: {} }, subscriptions: [], firstSeen: new Date('2026-07-15T00:00:00Z'), lastSeen: new Date('2026-07-15T00:00:00Z') };
}

function makeController(submitReceipt: jest.Mock): ReceiptsController {
  const service = { submitReceipt } as unknown as ReceiptsService;
  return new ReceiptsController(service);
}

function req(): RequestWithSdkApp {
  return { sdkApp: { id: 'app-1', projectId: 'project-1' } } as unknown as RequestWithSdkApp;
}

const validBody = {
  app_user_id: 'user-1',
  platform: 'APP_STORE' as const,
  fetch_token: 'signed-jws',
};

describe('ReceiptsController', () => {
  it('parses the body, delegates to ReceiptsService.submitReceipt with req.sdkApp, and wraps the result as { customerInfo }', async () => {
    const info = customerInfoFixture();
    const submitReceipt = jest.fn().mockResolvedValue(info);
    const controller = makeController(submitReceipt);

    const result = await controller.submitReceipt(req(), validBody);

    expect(result).toEqual({ customerInfo: info });
    expect(submitReceipt).toHaveBeenCalledWith({ id: 'app-1', projectId: 'project-1' }, validBody, expect.any(Number));
  });

  it('rejects (400) when app_user_id is missing', async () => {
    const controller = makeController(jest.fn());
    await expect(controller.submitReceipt(req(), { ...validBody, app_user_id: undefined })).rejects.toMatchObject({
      problem: { status: 400 },
    });
  });

  it('rejects (400) when platform is not APP_STORE/PLAY_STORE', async () => {
    const controller = makeController(jest.fn());
    await expect(controller.submitReceipt(req(), { ...validBody, platform: 'WEB' })).rejects.toMatchObject({
      problem: { status: 400 },
    });
  });

  it('rejects (400) when fetch_token is missing', async () => {
    const controller = makeController(jest.fn());
    await expect(controller.submitReceipt(req(), { ...validBody, fetch_token: undefined })).rejects.toMatchObject({
      problem: { status: 400 },
    });
  });

  it('re-throws whatever ReceiptsService rejects with (402/503/409 all flow through unmodified)', async () => {
    const rejection = { problem: { status: 402 } };
    const controller = makeController(jest.fn().mockRejectedValue(rejection));
    await expect(controller.submitReceipt(req(), validBody)).rejects.toBe(rejection);
  });
});
