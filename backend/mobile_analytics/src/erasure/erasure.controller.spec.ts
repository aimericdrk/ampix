import type { IngestRequest } from '../ingestion/ingest-auth';
import type { ErasureService } from './erasure.service';
import { ErasureController } from './erasure.controller';

const PROJECT_ID = '3f0a4b7c-0000-7000-8000-000000000001';

function reqFor(projectId: string): IngestRequest {
  return { ingestAuth: { projectId, token: 'mam_' + 'a'.repeat(32) } } as IngestRequest;
}

describe('ErasureController', () => {
  it('erases the user for the token-scoped project and returns what was cleared (happy path)', async () => {
    const cleared = { ids: ['firebase-uid'], subscriptionStates: 1, revenueCatWebhookEvents: 0 };
    const erase = jest.fn().mockResolvedValue(cleared);
    const controller = new ErasureController({ erase } as unknown as ErasureService);

    const result = await controller.eraseUser('firebase-uid', reqFor(PROJECT_ID));

    expect(erase).toHaveBeenCalledWith(PROJECT_ID, 'firebase-uid');
    expect(result).toEqual({ distinct_id: 'firebase-uid', deleted: true, cleared });
  });

  it('rejects an over-long distinctId with a 400 problem before erasing anything (error path)', async () => {
    const erase = jest.fn();
    const controller = new ErasureController({ erase } as unknown as ErasureService);

    await expect(controller.eraseUser('x'.repeat(256), reqFor(PROJECT_ID))).rejects.toMatchObject({
      problem: { status: 400 },
    });
    expect(erase).not.toHaveBeenCalled();
  });
});
