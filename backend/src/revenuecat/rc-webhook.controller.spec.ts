import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RcWebhookController } from './rc-webhook.controller';
import { RcWebhookGuard } from './rc-webhook.guard';

describe('RcWebhookController', () => {
  it('mounts RcWebhookGuard (and ONLY it — no JWT on the public webhook)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, RcWebhookController);
    expect(guards).toEqual([RcWebhookGuard]);
  });

  it('delegates to the processor with the guard-attached integration', async () => {
    const processor = { process: jest.fn(async () => undefined) } as any;
    const controller = new RcWebhookController(processor);
    const req: any = { rcIntegration: { id: 'int-1', projectId: 'pid', sandboxMode: false } };
    await controller.receive(req, { event: {} });
    expect(processor.process).toHaveBeenCalledWith(req.rcIntegration, { event: {} });
  });
});
