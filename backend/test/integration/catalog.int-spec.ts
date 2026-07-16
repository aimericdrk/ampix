import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { startTestStack, TestStack } from '../e2e/helpers/stack';

/**
 * Task 6 (RevenueCat-parity P0 catalog plan): proves `CatalogModule` actually composes into the
 * real app — routes resolve, `ProjectRolesGuard` is wired, and the create-app → product →
 * entitlement → attach → offering(current) → package chain persists through the real Postgres —
 * none of which the co-located service unit tests can exercise (they call the services directly).
 */

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

describe('catalog module wiring (e2e, RevenueCat-parity P0)', () => {
  let stack: TestStack;
  let server: Server;
  let ownerToken: string;
  let projectId: string;

  beforeAll(async () => {
    stack = await startTestStack({
      JWT_ACCESS_SECRET: 'catalog-e2e-access-secret-value-catalog',
      JWT_REFRESH_SECRET: 'catalog-e2e-refresh-secret-value-catalog',
    });
    server = stack.app.getHttpServer();

    const signup = await request(server)
      .post('/api/v1/auth/signup')
      .send({ email: uniqueEmail('owner'), password: 'password123', name: 'Catalog Owner' })
      .expect(200);
    ownerToken = signup.body.access_token;

    const projects = await request(server)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    projectId = projects.body.projects[0].id;
  }, 180_000);

  afterAll(async () => {
    await stack.stop();
  });

  function authed(token: string = ownerToken) {
    return {
      post: (path: string) => request(server).post(path).set('Authorization', `Bearer ${token}`),
      get: (path: string) => request(server).get(path).set('Authorization', `Bearer ${token}`),
    };
  }

  it('creates app → product → entitlement → attach → current offering → package, and a viewer can read it back', async () => {
    const base = `/api/v1/projects/${projectId}/catalog`;

    const app = await authed()
      .post(`${base}/apps`)
      .send({ name: 'iOS App', platform: 'IOS', bundleId: 'com.myampix.catalog.e2e' })
      .expect(201);
    expect(app.body).toMatchObject({ name: 'iOS App', platform: 'IOS', bundleId: 'com.myampix.catalog.e2e' });

    const product = await authed()
      .post(`${base}/products`)
      .send({
        appId: app.body.id,
        storeProductId: 'com.myampix.catalog.e2e.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Monthly',
      })
      .expect(201);
    expect(product.body).toMatchObject({ appId: app.body.id, storeProductId: 'com.myampix.catalog.e2e.monthly' });

    const entitlement = await authed()
      .post(`${base}/entitlements`)
      .send({ identifier: 'pro', displayName: 'Pro' })
      .expect(201);
    expect(entitlement.body).toMatchObject({ identifier: 'pro', displayName: 'Pro' });

    await authed()
      .post(`${base}/products/${product.body.id}/entitlements`)
      .send({ entitlementId: entitlement.body.id })
      .expect(201);

    const offering = await authed()
      .post(`${base}/offerings`)
      .send({ identifier: 'default', displayName: 'Default', isCurrent: true })
      .expect(201);
    expect(offering.body).toMatchObject({ identifier: 'default', isCurrent: true });

    const pkg = await authed()
      .post(`${base}/offerings/${offering.body.id}/packages`)
      .send({ identifier: '$rc_monthly', packageType: 'MONTHLY', productId: product.body.id })
      .expect(201);
    expect(pkg.body).toMatchObject({
      identifier: '$rc_monthly',
      packageType: 'MONTHLY',
      productId: product.body.id,
      offeringId: offering.body.id,
    });

    // Set up a project VIEWER (non-admin) to prove the read path is guard-reachable and the
    // write path is guard-blocked for that role.
    const viewerSignup = await request(server)
      .post('/api/v1/auth/signup')
      .send({ email: uniqueEmail('viewer'), password: 'password123', name: 'Catalog Viewer' })
      .expect(200);
    const viewerToken = viewerSignup.body.access_token;
    const viewerUserId = viewerSignup.body.user.id;

    const projectRow = await request(server)
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const orgId = projectRow.body.projects[0].org_id;

    const invite = await authed()
      .post(`/api/v1/orgs/${orgId}/invitations`)
      .send({ role: 'viewer' })
      .expect(201);
    await request(server)
      .post(`/api/v1/invitations/${invite.body.token}/accept`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    await authed()
      .post(`/api/v1/projects/${projectId}/members`)
      .send({ userId: viewerUserId, role: 'viewer' })
      .expect(201);

    // Viewer-visible GET: the resolved offering + packages, proving the whole chain persisted.
    const offeringsAsViewer = await authed(viewerToken).get(`${base}/offerings`).expect(200);
    expect(offeringsAsViewer.body).toHaveLength(1);
    expect(offeringsAsViewer.body[0]).toMatchObject({
      identifier: 'default',
      displayName: 'Default',
      isCurrent: true,
      packages: [
        {
          identifier: '$rc_monthly',
          packageType: 'MONTHLY',
          productId: product.body.id,
        },
      ],
    });

    // Viewer is blocked from the admin-only write route.
    await authed(viewerToken)
      .post(`${base}/apps`)
      .send({ name: 'Blocked App', platform: 'IOS', bundleId: 'com.myampix.catalog.blocked' })
      .expect(403);

    // The full chain is durably persisted — re-reading products/entitlements confirms it, not
    // just the immediate create responses above.
    const productsAsViewer = await authed(viewerToken).get(`${base}/products`).expect(200);
    expect(productsAsViewer.body).toHaveLength(1);
    expect(productsAsViewer.body[0].entitlements.map((e: { entitlementId: string }) => e.entitlementId)).toEqual([
      entitlement.body.id,
    ]);
  });

  it('rejects an unauthenticated POST /catalog/apps with 401', async () => {
    await request(server)
      .post(`/api/v1/projects/${projectId}/catalog/apps`)
      .send({ name: 'No Auth', platform: 'IOS', bundleId: 'com.myampix.catalog.noauth' })
      .expect(401);
  });
});
