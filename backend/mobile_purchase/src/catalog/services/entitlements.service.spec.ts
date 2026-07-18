import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { updateEntitlementSchema } from '../support/catalog.schemas';
import { parseOrThrow } from '../../common/zod';
import { ProblemException } from '../../common/problem-details';
import { EntitlementsService } from './entitlements.service';

jest.setTimeout(180000);

describe('EntitlementsService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: EntitlementsService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new EntitlementsService(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
  });

  it('creates an entitlement and lists it', async () => {
    const ent = await service.create(projectId, { identifier: 'pro', displayName: 'Pro' });
    expect(ent.identifier).toBe('pro');
    const list = await service.list(projectId);
    expect(list.map((e) => e.id)).toContain(ent.id);
  });

  it('rejects a duplicate identifier for the same project', async () => {
    await service.create(projectId, { identifier: 'dup', displayName: 'Dup' });
    await expect(
      service.create(projectId, { identifier: 'dup', displayName: 'Dup2' }),
    ).rejects.toMatchObject({ problem: { status: 409 } });
  });

  it('404s removing a non-existent or cross-tenant entitlement', async () => {
    await expect(service.remove(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });

    const otherProjectId = randomUUID();
    const ent = await service.create(otherProjectId, { identifier: 'other', displayName: 'Other' });
    await expect(service.remove(projectId, ent.id)).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('updates an entitlement’s displayName', async () => {
    const ent = await service.create(projectId, { identifier: 'update-happy', displayName: 'Before' });

    const updated = await service.update(projectId, ent.id, { displayName: 'After' });

    expect(updated).toMatchObject({ id: ent.id, displayName: 'After' });
  });

  it('update() 404s for a cross-project or non-existent entitlement', async () => {
    const otherProjectId = randomUUID();
    const ent = await service.create(projectId, { identifier: 'update-guard', displayName: 'Guarded' });

    await expect(service.update(otherProjectId, ent.id, { displayName: 'Nope' })).rejects.toMatchObject({
      problem: { status: 404 },
    });
    await expect(service.update(projectId, randomUUID(), { displayName: 'Nope' })).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('updateEntitlementSchema rejects an empty body (400)', () => {
    let caught: unknown;
    try {
      parseOrThrow(updateEntitlementSchema, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProblemException);
    expect((caught as ProblemException).problem).toMatchObject({ status: 400 });
  });

  it('updateEntitlementSchema strips the immutable identifier field, so it survives an update untouched', async () => {
    const ent = await service.create(projectId, { identifier: 'update-immutable', displayName: 'Before' });

    const patch = parseOrThrow(updateEntitlementSchema, { identifier: 'hijacked-identifier', displayName: 'After' });
    expect(patch).toEqual({ displayName: 'After' });

    const updated = await service.update(projectId, ent.id, patch);
    expect(updated).toMatchObject({ identifier: 'update-immutable', displayName: 'After' });
  });
});
