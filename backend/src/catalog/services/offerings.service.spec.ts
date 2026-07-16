import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { OfferingsService } from './offerings.service';

jest.setTimeout(180000);

describe('OfferingsService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: OfferingsService;
  let projectId: string;
  let productId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new OfferingsService(prisma as never);
    const org = await prisma.organization.create({ data: { name: 'O' } });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'P' } });
    projectId = project.id;
    const app = await prisma.app.create({
      data: { projectId, name: 'iOS', platform: 'IOS', bundleId: 'com.a.b', publicSdkKey: 'mrc_pub_test' },
    });
    const product = await prisma.product.create({
      data: {
        projectId,
        appId: app.id,
        storeProductId: 'com.a.b.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Monthly',
      },
    });
    productId = product.id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  it('creates an offering and lists it', async () => {
    const offering = await service.create(projectId, { identifier: 'default', displayName: 'Default' });
    expect(offering.projectId).toBe(projectId);
    const list = await service.list(projectId);
    expect(list.map((o) => o.id)).toContain(offering.id);
  });

  it('creating two offerings with isCurrent:true leaves exactly one current', async () => {
    await service.create(projectId, { identifier: 'summer', displayName: 'Summer', isCurrent: true });
    await service.create(projectId, { identifier: 'winter', displayName: 'Winter', isCurrent: true });

    const currentCount = await prisma.offering.count({ where: { projectId, isCurrent: true } });
    expect(currentCount).toBe(1);

    const winter = await prisma.offering.findFirst({ where: { projectId, identifier: 'winter' } });
    expect(winter?.isCurrent).toBe(true);
  });

  it('setCurrent atomically swaps the current offering, leaving exactly one current', async () => {
    const a = await service.create(projectId, { identifier: 'set-a', displayName: 'A', isCurrent: true });
    const b = await service.create(projectId, { identifier: 'set-b', displayName: 'B' });

    await service.setCurrent(projectId, b.id);

    const currentCount = await prisma.offering.count({ where: { projectId, isCurrent: true } });
    expect(currentCount).toBe(1);
    const refreshedA = await prisma.offering.findUnique({ where: { id: a.id } });
    const refreshedB = await prisma.offering.findUnique({ where: { id: b.id } });
    expect(refreshedA?.isCurrent).toBe(false);
    expect(refreshedB?.isCurrent).toBe(true);
  });

  it('setCurrent 404s for a cross-project or non-existent offering', async () => {
    const otherOrg = await prisma.organization.create({ data: { name: 'O-set-current' } });
    const otherProject = await prisma.project.create({ data: { orgId: otherOrg.id, name: 'P-set-current' } });
    const offering = await service.create(projectId, { identifier: 'set-current-guard', displayName: 'Guard' });

    await expect(service.setCurrent(otherProject.id, offering.id)).rejects.toMatchObject({ problem: { status: 404 } });
    await expect(service.setCurrent(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('rejects a duplicate offering identifier for the same project (@@unique([projectId, identifier]))', async () => {
    await service.create(projectId, { identifier: 'dup-offering', displayName: 'Dup' });
    await expect(service.create(projectId, { identifier: 'dup-offering', displayName: 'Dup2' })).rejects.toMatchObject({
      problem: { status: 409 },
    });
  });

  it('addPackage attaches a package to an offering', async () => {
    const offering = await service.create(projectId, { identifier: 'pkg-offering', displayName: 'Pkg' });
    const pkg = await service.addPackage(projectId, offering.id, {
      identifier: '$rc_monthly',
      packageType: 'MONTHLY',
      productId,
    });
    expect(pkg.offeringId).toBe(offering.id);
    expect(pkg.productId).toBe(productId);
  });

  it('addPackage 404s for a non-existent/cross-project offering', async () => {
    const otherOrg = await prisma.organization.create({ data: { name: 'O-pkg-offering' } });
    const otherProject = await prisma.project.create({ data: { orgId: otherOrg.id, name: 'P-pkg-offering' } });

    await expect(
      service.addPackage(otherProject.id, (await service.create(projectId, { identifier: 'foreign-offering', displayName: 'Foreign' })).id, {
        identifier: '$rc_monthly',
        packageType: 'MONTHLY',
        productId,
      }),
    ).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('addPackage rejects a productId that belongs to another project (400)', async () => {
    const otherOrg = await prisma.organization.create({ data: { name: 'O-foreign-product' } });
    const otherProject = await prisma.project.create({ data: { orgId: otherOrg.id, name: 'P-foreign-product' } });
    const otherApp = await prisma.app.create({
      data: { projectId: otherProject.id, name: 'Android', platform: 'ANDROID', packageName: 'com.other.app', publicSdkKey: 'mrc_pub_other' },
    });
    const foreignProduct = await prisma.product.create({
      data: {
        projectId: otherProject.id,
        appId: otherApp.id,
        storeProductId: 'other.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Other Monthly',
      },
    });
    const offering = await service.create(projectId, { identifier: 'foreign-product-offering', displayName: 'Foreign Product' });

    await expect(
      service.addPackage(projectId, offering.id, {
        identifier: '$rc_monthly',
        packageType: 'MONTHLY',
        productId: foreignProduct.id,
      }),
    ).rejects.toMatchObject({ problem: { status: 400 } });
  });

  it('rejects a duplicate package identifier within an offering (@@unique([offeringId, identifier])) with 409', async () => {
    const offering = await service.create(projectId, { identifier: 'dup-pkg-offering', displayName: 'DupPkg' });
    await service.addPackage(projectId, offering.id, { identifier: '$rc_monthly', packageType: 'MONTHLY', productId });

    await expect(
      service.addPackage(projectId, offering.id, { identifier: '$rc_monthly', packageType: 'ANNUAL', productId }),
    ).rejects.toMatchObject({ problem: { status: 409 } });
  });

  it('removePackage removes a package scoped to the offering, and is idempotent', async () => {
    const offering = await service.create(projectId, { identifier: 'remove-pkg-offering', displayName: 'RemovePkg' });
    const pkg = await service.addPackage(projectId, offering.id, { identifier: '$rc_annual', packageType: 'ANNUAL', productId });

    await service.removePackage(projectId, offering.id, pkg.id);
    const found = await prisma.package.findUnique({ where: { id: pkg.id } });
    expect(found).toBeNull();

    await expect(service.removePackage(projectId, offering.id, pkg.id)).resolves.not.toThrow();
  });

  it('remove() deletes an offering and 404s for a cross-project or non-existent offering', async () => {
    const otherOrg = await prisma.organization.create({ data: { name: 'O-remove-offering' } });
    const otherProject = await prisma.project.create({ data: { orgId: otherOrg.id, name: 'P-remove-offering' } });
    const offering = await service.create(projectId, { identifier: 'remove-offering', displayName: 'RemoveMe' });

    await expect(service.remove(otherProject.id, offering.id)).rejects.toMatchObject({ problem: { status: 404 } });
    await expect(service.remove(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });

    await service.remove(projectId, offering.id);
    const found = await prisma.offering.findUnique({ where: { id: offering.id } });
    expect(found).toBeNull();
  });
});
