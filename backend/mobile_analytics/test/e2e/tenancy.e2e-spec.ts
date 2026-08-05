import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startTestStack, TestStack } from './helpers/stack';

function uniqueEmail(): string {
  return `user-${randomUUID()}@example.com`;
}

async function signup(stack: TestStack, email: string) {
  const res = await request(stack.app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', name: 'Test User' })
    .expect(200);
  return { accessToken: res.body.access_token as string, userId: res.body.user.id as string };
}

function auth(token: string) {
  return `Bearer ${token}`;
}

function makeEvent(): Record<string, unknown> {
  return {
    insert_id: randomUUID(),
    event: 'checkout_completed',
    distinct_id: 'u_42',
    anon_id: randomUUID(),
    session_id: randomUUID(),
    timestamp: Date.now(),
    properties: {},
  };
}

describe('Tenancy management (e2e, contracts §13)', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack({
      JWT_ACCESS_SECRET: 'e2e-access-secret-value-e2e-access',
      JWT_REFRESH_SECRET: 'e2e-refresh-secret-value-e2e-refresh',
    });
  }, 120_000);

  afterAll(async () => {
    await stack.stop();
  });

  describe('full role matrix: admin creates org/project/token/invite, an invited viewer is then 403 on admin mutations', () => {
    let admin: { accessToken: string; userId: string };
    let orgId: string;
    let projectId: string;
    let tokenId: string;
    let viewer: { accessToken: string; userId: string };

    it('admin creates an org', async () => {
      admin = await signup(stack, uniqueEmail());

      const res = await request(stack.app.getHttpServer())
        .post('/api/v1/orgs')
        .set('Authorization', auth(admin.accessToken))
        .send({ name: 'Acme' })
        .expect(201);

      // The creator becomes org `owner` (Tasks 1–2, org-owner-role plan) — ranks above `admin`.
      expect(res.body).toEqual({ id: expect.any(String), name: 'Acme', role: 'owner' });
      orgId = res.body.id;
    });

    it('GET /api/v1/orgs lists the org with the creator as admin', async () => {
      const res = await request(stack.app.getHttpServer())
        .get('/api/v1/orgs')
        .set('Authorization', auth(admin.accessToken))
        .expect(200);
      expect(res.body.orgs).toEqual(
        expect.arrayContaining([{ id: orgId, name: 'Acme', role: 'owner' }]),
      );
    });

    it('admin creates a project under the org (with an initial ingest token)', async () => {
      const res = await request(stack.app.getHttpServer())
        .post(`/api/v1/orgs/${orgId}/projects`)
        .set('Authorization', auth(admin.accessToken))
        .send({ name: 'Mobile App', timezone: 'Europe/Paris' })
        .expect(201);

      expect(res.body).toMatchObject({
        org_id: orgId,
        name: 'Mobile App',
        timezone: 'Europe/Paris',
      });
      expect(res.body.ingest_token).toMatch(/^mam_[0-9a-f]{32}$/);
      projectId = res.body.id;
    });

    it('the new project appears in GET /api/v1/projects for the admin', async () => {
      const res = await request(stack.app.getHttpServer())
        .get('/api/v1/projects')
        .set('Authorization', auth(admin.accessToken))
        .expect(200);

      expect(
        res.body.projects.some(
          (p: { id: string; org_id: string; name: string }) =>
            p.id === projectId && p.org_id === orgId && p.name === 'Mobile App',
        ),
      ).toBe(true);
    });

    it('admin creates an additional SDK token for the project', async () => {
      const res = await request(stack.app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/tokens`)
        .set('Authorization', auth(admin.accessToken))
        .send({ label: 'CI' })
        .expect(201);

      expect(res.body.token).toMatch(/^mam_[0-9a-f]{32}$/);
      expect(res.body.label).toBe('CI');
      tokenId = res.body.id;

      const list = await request(stack.app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/tokens`)
        .set('Authorization', auth(admin.accessToken))
        .expect(200);
      expect(list.body.tokens.length).toBeGreaterThanOrEqual(2); // initial + this one
    });

    it('admin creates an invitation for a viewer', async () => {
      const res = await request(stack.app.getHttpServer())
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', auth(admin.accessToken))
        .send({ role: 'viewer' })
        .expect(201);

      expect(res.body).toMatchObject({ role: 'viewer', invite_path: `/invite/${res.body.token}` });
      expect(res.body.expires_at).toEqual(expect.any(String));

      const publicRes = await request(stack.app.getHttpServer())
        .get(`/api/v1/invitations/${res.body.token}`)
        .expect(200); // PUBLIC — no Authorization header at all
      expect(publicRes.body).toEqual({
        org_name: 'Acme',
        role: 'viewer',
        expires_at: res.body.expires_at,
      });

      viewer = await signup(stack, uniqueEmail());
      const acceptRes = await request(stack.app.getHttpServer())
        .post(`/api/v1/invitations/${res.body.token}/accept`)
        .set('Authorization', auth(viewer.accessToken))
        .expect(200);
      expect(acceptRes.body).toEqual({ org_id: orgId, role: 'viewer' });
    });

    it('the invited viewer can read (member-level) but gets 403 on every admin mutation', async () => {
      const viewerAuth = auth(viewer.accessToken);
      const http = stack.app.getHttpServer();

      // Reads: any member (viewer+) is allowed.
      await request(http)
        .get(`/api/v1/orgs/${orgId}/members`)
        .set('Authorization', viewerAuth)
        .expect(200);

      // Mutations: admin only -> 403 for the viewer, throughout.
      await request(http)
        .patch(`/api/v1/orgs/${orgId}`)
        .set('Authorization', viewerAuth)
        .send({ name: 'Hijacked' })
        .expect(403);
      await request(http)
        .post(`/api/v1/orgs/${orgId}/projects`)
        .set('Authorization', viewerAuth)
        .send({ name: 'Rogue Project' })
        .expect(403);
      await request(http)
        .patch(`/api/v1/orgs/${orgId}/members/${admin.userId}`)
        .set('Authorization', viewerAuth)
        .send({ role: 'viewer' })
        .expect(403);
      await request(http)
        .delete(`/api/v1/orgs/${orgId}/members/${admin.userId}`)
        .set('Authorization', viewerAuth)
        .expect(403);
      await request(http)
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', viewerAuth)
        .send({ role: 'analyst' })
        .expect(403);
      await request(http)
        .get(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', viewerAuth)
        .expect(403);
      await request(http)
        .patch(`/api/v1/projects/${projectId}`)
        .set('Authorization', viewerAuth)
        .send({ name: 'Renamed' })
        .expect(403);
      await request(http)
        .get(`/api/v1/projects/${projectId}/tokens`)
        .set('Authorization', viewerAuth)
        .expect(403);
      await request(http)
        .post(`/api/v1/projects/${projectId}/tokens`)
        .set('Authorization', viewerAuth)
        .expect(403);
      await request(http)
        .delete(`/api/v1/projects/${projectId}/tokens/${tokenId}`)
        .set('Authorization', viewerAuth)
        .expect(403);
      await request(http)
        .delete(`/api/v1/projects/${projectId}`)
        .set('Authorization', viewerAuth)
        .expect(403);
    });

    it('accepting the same invitation again is idempotent (200, role unchanged)', async () => {
      // Re-fetch a fresh invitation to accept twice, proving replay-safety independent of expiry.
      const invite = await request(stack.app.getHttpServer())
        .post(`/api/v1/orgs/${orgId}/invitations`)
        .set('Authorization', auth(admin.accessToken))
        .send({ role: 'analyst' })
        .expect(201);

      const another = await signup(stack, uniqueEmail());
      const first = await request(stack.app.getHttpServer())
        .post(`/api/v1/invitations/${invite.body.token}/accept`)
        .set('Authorization', auth(another.accessToken))
        .expect(200);
      expect(first.body).toEqual({ org_id: orgId, role: 'analyst' });

      const second = await request(stack.app.getHttpServer())
        .post(`/api/v1/invitations/${invite.body.token}/accept`)
        .set('Authorization', auth(another.accessToken))
        .expect(200);
      expect(second.body).toEqual({ org_id: orgId, role: 'analyst' });

      // A DIFFERENT user must now find the token single-use (410 Gone).
      const outsider = await signup(stack, uniqueEmail());
      await request(stack.app.getHttpServer())
        .post(`/api/v1/invitations/${invite.body.token}/accept`)
        .set('Authorization', auth(outsider.accessToken))
        .expect(410);
    });

    it(
      'single-use race regression: two brand-new users accepting the SAME never-accepted ' +
        'token at the same instant — exactly one becomes a member, the other 410s',
      async () => {
        const http = stack.app.getHttpServer();
        const invite = await request(http)
          .post(`/api/v1/orgs/${orgId}/invitations`)
          .set('Authorization', auth(admin.accessToken))
          .send({ role: 'analyst' })
          .expect(201);

        const [challenger1, challenger2] = await Promise.all([
          signup(stack, uniqueEmail()),
          signup(stack, uniqueEmail()),
        ]);

        // Fire both accepts concurrently against the SAME real Postgres — before the fix, both
        // could pass "findUnique -> not yet accepted" and each create their own membership.
        const [res1, res2] = await Promise.all([
          request(http)
            .post(`/api/v1/invitations/${invite.body.token}/accept`)
            .set('Authorization', auth(challenger1.accessToken)),
          request(http)
            .post(`/api/v1/invitations/${invite.body.token}/accept`)
            .set('Authorization', auth(challenger2.accessToken)),
        ]);

        expect([res1.status, res2.status].sort()).toEqual([200, 410]);
        const winner = res1.status === 200 ? challenger1 : challenger2;
        expect((res1.status === 200 ? res1 : res2).body).toEqual({
          org_id: orgId,
          role: 'analyst',
        });

        const members = await request(http)
          .get(`/api/v1/orgs/${orgId}/members`)
          .set('Authorization', auth(admin.accessToken))
          .expect(200);
        const winnerMemberships = members.body.members.filter(
          (m: { user: { id: string } }) => m.user.id === winner.userId,
        );
        expect(winnerMemberships).toHaveLength(1); // exactly one membership row, never two
      },
      30_000,
    );

    /**
     * `admin` in this describe block is the ORG CREATOR — per the org-owner-role plan (Tasks 1–2,
     * already shipped), the creator's Membership role is `owner`, not `admin`. Owner protection
     * replaces the old last-admin guard entirely (Task 4): the owner's role can never be changed
     * or removed directly (only via an atomic ownership transfer), while a non-owner admin is now
     * freely demotable/removable even as the org's only admin — there is no last-admin guard left.
     */
    describe('owner protection (SECURITY-CRITICAL)', () => {
      it('cannot demote the owner directly -> 409 (must transfer ownership instead)', async () => {
        await request(stack.app.getHttpServer())
          .patch(`/api/v1/orgs/${orgId}/members/${admin.userId}`)
          .set('Authorization', auth(admin.accessToken))
          .send({ role: 'viewer' })
          .expect(409);
      });

      it('cannot remove the owner -> 409', async () => {
        await request(stack.app.getHttpServer())
          .delete(`/api/v1/orgs/${orgId}/members/${admin.userId}`)
          .set('Authorization', auth(admin.accessToken))
          .expect(409);
      });

      it(
        'the owner stays immutable even once a second admin exists; that non-owner admin, by ' +
          'contrast, CAN be freely demoted — there is no last-admin guard anymore',
        async () => {
          const http = stack.app.getHttpServer();
          await request(http)
            .patch(`/api/v1/orgs/${orgId}/members/${viewer.userId}`)
            .set('Authorization', auth(admin.accessToken))
            .send({ role: 'admin' })
            .expect(200);

          // admin.userId is this org's OWNER (the creator) — still 409, regardless of how many
          // other admins exist.
          await request(http)
            .patch(`/api/v1/orgs/${orgId}/members/${admin.userId}`)
            .set('Authorization', auth(admin.accessToken))
            .send({ role: 'viewer' })
            .expect(409);

          // viewer.userId, now a plain (non-owner) admin, has no such protection.
          await request(http)
            .patch(`/api/v1/orgs/${orgId}/members/${viewer.userId}`)
            .set('Authorization', auth(admin.accessToken))
            .send({ role: 'viewer' })
            .expect(200);

          // Restore: promote back to admin so later tests in this block are unaffected.
          await request(http)
            .patch(`/api/v1/orgs/${orgId}/members/${viewer.userId}`)
            .set('Authorization', auth(admin.accessToken))
            .send({ role: 'admin' })
            .expect(200);
        },
      );

      it(
        'TOCTOU regression: the owner racing to transfer ownership to two different members at ' +
          'the same instant never leaves the org with zero or two owners — exactly one transfer ' +
          'wins, the other is rejected',
        async () => {
          const http = stack.app.getHttpServer();

          const raceOwner = await signup(stack, uniqueEmail());
          const raceOrg = await request(http)
            .post('/api/v1/orgs')
            .set('Authorization', auth(raceOwner.accessToken))
            .send({ name: 'Transfer Race Org' })
            .expect(201);
          const raceOrgId = raceOrg.body.id as string;

          const inviteA = await request(http)
            .post(`/api/v1/orgs/${raceOrgId}/invitations`)
            .set('Authorization', auth(raceOwner.accessToken))
            .send({ role: 'viewer' })
            .expect(201);
          const candidateA = await signup(stack, uniqueEmail());
          await request(http)
            .post(`/api/v1/invitations/${inviteA.body.token}/accept`)
            .set('Authorization', auth(candidateA.accessToken))
            .expect(200);

          const inviteB = await request(http)
            .post(`/api/v1/orgs/${raceOrgId}/invitations`)
            .set('Authorization', auth(raceOwner.accessToken))
            .send({ role: 'viewer' })
            .expect(201);
          const candidateB = await signup(stack, uniqueEmail());
          await request(http)
            .post(`/api/v1/invitations/${inviteB.body.token}/accept`)
            .set('Authorization', auth(candidateB.accessToken))
            .expect(200);
          // raceOwner is the sole owner; candidateA and candidateB are both plain viewers.

          // Fire both transfers concurrently against the SAME real Postgres, both initiated by
          // the (at-that-instant) current owner — before the fix, both could independently
          // observe "I am the owner" and both succeed, stranding the org with two owners.
          const [resA, resB] = await Promise.all([
            request(http)
              .patch(`/api/v1/orgs/${raceOrgId}/members/${candidateA.userId}`)
              .set('Authorization', auth(raceOwner.accessToken))
              .send({ role: 'owner' }),
            request(http)
              .patch(`/api/v1/orgs/${raceOrgId}/members/${candidateB.userId}`)
              .set('Authorization', auth(raceOwner.accessToken))
              .send({ role: 'owner' }),
          ]);

          expect([resA.status, resB.status].sort()).toEqual([200, 403]);
          const winner = resA.status === 200 ? candidateA : candidateB;

          const members = await request(http)
            .get(`/api/v1/orgs/${raceOrgId}/members`)
            .set('Authorization', auth(raceOwner.accessToken))
            .expect(200);
          const owners = members.body.members.filter((m: { role: string }) => m.role === 'owner');
          expect(owners).toHaveLength(1); // never 0, never 2
          expect(owners[0].user.id).toBe(winner.userId);
        },
        30_000,
      );
    });

    describe('token revocation takes effect on the ingest path', () => {
      it('revoking a token then posting /ingest/events with it -> 401', async () => {
        const http = stack.app.getHttpServer();
        const created = await request(http)
          .post(`/api/v1/projects/${projectId}/tokens`)
          .set('Authorization', auth(admin.accessToken))
          .send({ label: 'to-revoke' })
          .expect(201);
        const revokedToken = created.body.token as string;

        // Sanity: the token works before revocation.
        await request(http)
          .post('/ingest/events')
          .set('Authorization', `Bearer ${revokedToken}`)
          .send({ events: [makeEvent()] })
          .expect(202);

        await request(http)
          .delete(`/api/v1/projects/${projectId}/tokens/${created.body.id}`)
          .set('Authorization', auth(admin.accessToken))
          .expect(204);

        await request(http)
          .post('/ingest/events')
          .set('Authorization', `Bearer ${revokedToken}`)
          .send({ events: [makeEvent()] })
          .expect(401)
          .expect('Content-Type', /application\/problem\+json/);
      });

      it('a revoked token no longer appears in GET /tokens', async () => {
        const res = await request(stack.app.getHttpServer())
          .get(`/api/v1/projects/${projectId}/tokens`)
          .set('Authorization', auth(admin.accessToken))
          .expect(200);
        expect(res.body.tokens.some((t: { label: string }) => t.label === 'to-revoke')).toBe(false);
      });
    });
  });

  /**
   * Per-project visibility (contracts §16): `GET /api/v1/projects` and project-scoped routes are
   * gated by `ProjectMembership`, not by org membership. An org member — even an org admin —
   * who was never granted a `ProjectMembership` must neither see the project in their listing
   * nor be able to read it directly; once the project owner adds them via
   * `POST /api/v1/projects/:projectId/members`, both open up at the granted role.
   */
  describe('per-project visibility: ProjectMembership gates access, not org membership', () => {
    it(
      'creator sees their project (auto-owner); a second org member with no ' +
        'ProjectMembership sees neither the project nor its data, and gains both only after ' +
        'being explicitly added',
      async () => {
        const http = stack.app.getHttpServer();

        const owner = await signup(stack, uniqueEmail());
        const orgRes = await request(http)
          .post('/api/v1/orgs')
          .set('Authorization', auth(owner.accessToken))
          .send({ name: 'Visibility Org' })
          .expect(201);
        const visOrgId = orgRes.body.id as string;

        const projectRes = await request(http)
          .post(`/api/v1/orgs/${visOrgId}/projects`)
          .set('Authorization', auth(owner.accessToken))
          .send({ name: 'Restricted Project' })
          .expect(201);
        const visProjectId = projectRes.body.id as string;

        // The creator is auto-granted `owner` and sees the project in their own listing.
        const ownerProjects = await request(http)
          .get('/api/v1/projects')
          .set('Authorization', auth(owner.accessToken))
          .expect(200);
        const ownerEntry = ownerProjects.body.projects.find(
          (p: { id: string }) => p.id === visProjectId,
        );
        expect(ownerEntry).toMatchObject({ id: visProjectId, role: 'owner' });

        // Invite a SECOND user into the org as ORG ADMIN — deliberately a high org role, to
        // prove org role alone (even admin) is not sufficient for project access.
        const invite = await request(http)
          .post(`/api/v1/orgs/${visOrgId}/invitations`)
          .set('Authorization', auth(owner.accessToken))
          .send({ role: 'admin' })
          .expect(201);
        const second = await signup(stack, uniqueEmail());
        await request(http)
          .post(`/api/v1/invitations/${invite.body.token}/accept`)
          .set('Authorization', auth(second.accessToken))
          .expect(200);

        // Org membership alone: the project is ABSENT from the second user's listing.
        const secondProjectsBefore = await request(http)
          .get('/api/v1/projects')
          .set('Authorization', auth(second.accessToken))
          .expect(200);
        expect(
          secondProjectsBefore.body.projects.some((p: { id: string }) => p.id === visProjectId),
        ).toBe(false);

        // ...and direct project-scoped access is 403, not just absent from the list.
        await request(http)
          .get(`/api/v1/projects/${visProjectId}/events/summary`)
          .set('Authorization', auth(second.accessToken))
          .expect(403);
        await request(http)
          .get(`/api/v1/projects/${visProjectId}/dashboards`)
          .set('Authorization', auth(second.accessToken))
          .expect(403);

        // The owner explicitly adds the second user to THIS project as 'analyst'.
        const addRes = await request(http)
          .post(`/api/v1/projects/${visProjectId}/members`)
          .set('Authorization', auth(owner.accessToken))
          .send({ userId: second.userId, role: 'analyst' })
          .expect(201);
        expect(addRes.body).toEqual({ user_id: second.userId, role: 'analyst' });

        // Now the project appears in their listing, at the granted role...
        const secondProjectsAfter = await request(http)
          .get('/api/v1/projects')
          .set('Authorization', auth(second.accessToken))
          .expect(200);
        const secondEntry = secondProjectsAfter.body.projects.find(
          (p: { id: string }) => p.id === visProjectId,
        );
        expect(secondEntry).toMatchObject({ id: visProjectId, role: 'analyst' });

        // ...and direct project-scoped reads succeed at that role.
        await request(http)
          .get(`/api/v1/projects/${visProjectId}/events/summary`)
          .set('Authorization', auth(second.accessToken))
          .expect(200);
        await request(http)
          .get(`/api/v1/projects/${visProjectId}/dashboards`)
          .set('Authorization', auth(second.accessToken))
          .expect(200);
      },
    );
  });

  /**
   * Org `owner` role (Tasks 1–5): the org creator becomes org `owner`, which ranks above `admin`
   * and carries DERIVED access to every project in the org — no `ProjectMembership` row required.
   * Separately, an owner/admin can grant a specific member per-project access from org settings
   * via `PUT /api/v1/orgs/:orgId/members/:userId/project-access/:projectId`.
   */
  describe('org owner role: derived project access + org-scoped project-access grants', () => {
    it(
      'an org owner reads a project they were never explicitly added to (no ProjectMembership row)',
      async () => {
        const http = stack.app.getHttpServer();

        const owner = await signup(stack, uniqueEmail());
        const orgRes = await request(http)
          .post('/api/v1/orgs')
          .set('Authorization', auth(owner.accessToken))
          .send({ name: 'Owner Org' })
          .expect(201);
        expect(orgRes.body.role).toBe('owner');
        const ownerOrgId = orgRes.body.id as string;

        const projectRes = await request(http)
          .post(`/api/v1/orgs/${ownerOrgId}/projects`)
          .set('Authorization', auth(owner.accessToken))
          .send({ name: 'Owner Derived Project' })
          .expect(201);
        const ownerProjectId = projectRes.body.id as string;

        // The creator DOES get an explicit ProjectMembership row on project creation (see the
        // per-project-visibility block above, where the creator shows up as project role
        // 'owner'). To exercise the DERIVED-access seam specifically — an org owner reading a
        // project they hold NO ProjectMembership row for — remove that row directly and confirm
        // access is preserved purely via org-owner derivation.
        await stack.prisma.projectMembership.delete({
          where: { userId_projectId: { userId: owner.userId, projectId: ownerProjectId } },
        });

        const rows = await stack.prisma.projectMembership.findMany({
          where: { userId: owner.userId, projectId: ownerProjectId },
        });
        expect(rows).toHaveLength(0);

        await request(http)
          .get(`/api/v1/projects/${ownerProjectId}/events/summary`)
          .set('Authorization', auth(owner.accessToken))
          .expect(200);
      },
    );

    it(
      'an org admin grants a member viewer access to a project via org settings, and the member ' +
        'goes from 403 to 200 on that project',
      async () => {
        const http = stack.app.getHttpServer();

        const owner = await signup(stack, uniqueEmail());
        const orgRes = await request(http)
          .post('/api/v1/orgs')
          .set('Authorization', auth(owner.accessToken))
          .send({ name: 'Grant Org' })
          .expect(201);
        const grantOrgId = orgRes.body.id as string;

        const projectRes = await request(http)
          .post(`/api/v1/orgs/${grantOrgId}/projects`)
          .set('Authorization', auth(owner.accessToken))
          .send({ name: 'Grant Project' })
          .expect(201);
        const grantProjectId = projectRes.body.id as string;

        // A second org member, promoted to org ADMIN, will do the granting.
        const adminInvite = await request(http)
          .post(`/api/v1/orgs/${grantOrgId}/invitations`)
          .set('Authorization', auth(owner.accessToken))
          .send({ role: 'admin' })
          .expect(201);
        const admin = await signup(stack, uniqueEmail());
        await request(http)
          .post(`/api/v1/invitations/${adminInvite.body.token}/accept`)
          .set('Authorization', auth(admin.accessToken))
          .expect(200);

        // A third org member — the target of the grant — has no project access yet.
        const memberInvite = await request(http)
          .post(`/api/v1/orgs/${grantOrgId}/invitations`)
          .set('Authorization', auth(owner.accessToken))
          .send({ role: 'viewer' })
          .expect(201);
        const member = await signup(stack, uniqueEmail());
        await request(http)
          .post(`/api/v1/invitations/${memberInvite.body.token}/accept`)
          .set('Authorization', auth(member.accessToken))
          .expect(200);

        // Before the grant: 403, not just absent from the listing.
        await request(http)
          .get(`/api/v1/projects/${grantProjectId}/events/summary`)
          .set('Authorization', auth(member.accessToken))
          .expect(403);

        const grantRes = await request(http)
          .put(`/api/v1/orgs/${grantOrgId}/members/${member.userId}/project-access/${grantProjectId}`)
          .set('Authorization', auth(admin.accessToken))
          .send({ role: 'viewer' })
          .expect(200);
        expect(grantRes.body).toEqual({ projectId: grantProjectId, role: 'viewer' });

        // After the grant: 200.
        await request(http)
          .get(`/api/v1/projects/${grantProjectId}/events/summary`)
          .set('Authorization', auth(member.accessToken))
          .expect(200);

        // GET .../project-access reflects the grant too (admin-only listing route).
        const listRes = await request(http)
          .get(`/api/v1/orgs/${grantOrgId}/members/${member.userId}/project-access`)
          .set('Authorization', auth(admin.accessToken))
          .expect(200);
        expect(listRes.body.projects).toEqual(
          expect.arrayContaining([
            { projectId: grantProjectId, name: 'Grant Project', role: 'viewer' },
          ]),
        );
      },
    );
  });

  describe('non-members and unknown ids', () => {
    it('a non-member gets 403 on org-scoped routes (not 404 — the org exists)', async () => {
      const owner = await signup(stack, uniqueEmail());
      const orgRes = await request(stack.app.getHttpServer())
        .post('/api/v1/orgs')
        .set('Authorization', auth(owner.accessToken))
        .send({ name: 'Private Org' })
        .expect(201);

      const outsider = await signup(stack, uniqueEmail());
      await request(stack.app.getHttpServer())
        .get(`/api/v1/orgs/${orgRes.body.id}/members`)
        .set('Authorization', auth(outsider.accessToken))
        .expect(403);
      await request(stack.app.getHttpServer())
        .patch(`/api/v1/orgs/${orgRes.body.id}`)
        .set('Authorization', auth(outsider.accessToken))
        .send({ name: 'Hijacked' })
        .expect(403);
    });

    it('an unknown org id -> 404, even for an authenticated admin elsewhere', async () => {
      const user = await signup(stack, uniqueEmail());
      await request(stack.app.getHttpServer())
        .patch(`/api/v1/orgs/${randomUUID()}`)
        .set('Authorization', auth(user.accessToken))
        .send({ name: 'x' })
        .expect(404);
    });

    it('an unknown project id -> 404 for project-scoped admin routes', async () => {
      const user = await signup(stack, uniqueEmail());
      await request(stack.app.getHttpServer())
        .patch(`/api/v1/projects/${randomUUID()}`)
        .set('Authorization', auth(user.accessToken))
        .send({ name: 'x' })
        .expect(404);
    });

    it('unauthenticated requests get 401 on protected routes', async () => {
      await request(stack.app.getHttpServer()).get('/api/v1/orgs').expect(401);
      await request(stack.app.getHttpServer()).post('/api/v1/orgs').send({ name: 'x' }).expect(401);
    });

    it('malformed (non-UUID-shaped) :userId/:invitationId/:tokenId -> 404, never a 500', async () => {
      const http = stack.app.getHttpServer();
      const owner = await signup(stack, uniqueEmail());
      const orgRes = await request(http)
        .post('/api/v1/orgs')
        .set('Authorization', auth(owner.accessToken))
        .send({ name: 'Malformed Ids Org' })
        .expect(201);
      const malformedIdsOrgId = orgRes.body.id as string;
      const projectRes = await request(http)
        .post(`/api/v1/orgs/${malformedIdsOrgId}/projects`)
        .set('Authorization', auth(owner.accessToken))
        .send({ name: 'App' })
        .expect(201);

      await request(http)
        .patch(`/api/v1/orgs/${malformedIdsOrgId}/members/not-a-uuid`)
        .set('Authorization', auth(owner.accessToken))
        .send({ role: 'viewer' })
        .expect(404);
      await request(http)
        .delete(`/api/v1/orgs/${malformedIdsOrgId}/members/not-a-uuid`)
        .set('Authorization', auth(owner.accessToken))
        .expect(404);
      await request(http)
        .delete(`/api/v1/orgs/${malformedIdsOrgId}/invitations/not-a-uuid`)
        .set('Authorization', auth(owner.accessToken))
        .expect(404);
      await request(http)
        .delete(`/api/v1/projects/${projectRes.body.id}/tokens/not-a-uuid`)
        .set('Authorization', auth(owner.accessToken))
        .expect(404);
    });
  });

  describe('account management (contracts §13)', () => {
    it('PATCH /auth/me renames the account', async () => {
      const user = await signup(stack, uniqueEmail());
      const res = await request(stack.app.getHttpServer())
        .patch('/api/v1/auth/me')
        .set('Authorization', auth(user.accessToken))
        .send({ name: 'Renamed User' })
        .expect(200);
      expect(res.body).toMatchObject({ id: user.userId, name: 'Renamed User' });
    });

    it('POST /auth/password changes the password (old fails to log in, new succeeds); wrong current -> 401', async () => {
      const email = uniqueEmail();
      const user = await signup(stack, email);
      const http = stack.app.getHttpServer();

      await request(http)
        .post('/api/v1/auth/password')
        .set('Authorization', auth(user.accessToken))
        .send({ current_password: 'wrong-password', new_password: 'new-password123' })
        .expect(401);

      await request(http)
        .post('/api/v1/auth/password')
        .set('Authorization', auth(user.accessToken))
        .send({ current_password: 'password123', new_password: 'new-password123' })
        .expect(204);

      await request(http)
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(401);
      await request(http)
        .post('/api/v1/auth/login')
        .send({ email, password: 'new-password123' })
        .expect(200);
    });
  });
});
