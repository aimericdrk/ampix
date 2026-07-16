import type { AppConfig } from '../config/app-config';
import { ProjectAccessService, projectRoleRank } from './project-access.service';

const ANALYTICS_INTERNAL_URL = 'http://analytics.internal:8088';
const PROJECT_ID = 'project-1';
const AUTH_HEADER = 'Bearer token-1';

function makeConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    port: 8090,
    databaseUrl: 'postgresql://x',
    logLevel: 'silent',
    analyticsInternalUrl: ANALYTICS_INTERNAL_URL,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('projectRoleRank', () => {
  it('orders owner > admin > analyst > viewer', () => {
    expect(projectRoleRank('owner')).toBeGreaterThan(projectRoleRank('admin'));
    expect(projectRoleRank('admin')).toBeGreaterThan(projectRoleRank('analyst'));
    expect(projectRoleRank('analyst')).toBeGreaterThan(projectRoleRank('viewer'));
  });
});

describe('ProjectAccessService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the role and forwards the Authorization header on 200', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { role: 'admin' }));
    const service = new ProjectAccessService(makeConfig());

    await expect(service.getProjectRole(PROJECT_ID, AUTH_HEADER)).resolves.toBe('admin');
    expect(fetchMock).toHaveBeenCalledWith(
      `${ANALYTICS_INTERNAL_URL}/api/v1/internal/projects/${PROJECT_ID}/role`,
      { headers: { Authorization: AUTH_HEADER } },
    );
  });

  it.each([401, 403, 404])('returns null (deny) when analytics responds %d', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse(status, {}));
    const service = new ProjectAccessService(makeConfig());

    await expect(service.getProjectRole(PROJECT_ID, AUTH_HEADER)).resolves.toBeNull();
  });

  it('returns null without calling fetch when the Authorization header is missing', async () => {
    const service = new ProjectAccessService(makeConfig());

    await expect(service.getProjectRole(PROJECT_ID, undefined)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a 503 ProblemException when analytics is unreachable (network error)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const service = new ProjectAccessService(makeConfig());

    await expect(service.getProjectRole(PROJECT_ID, AUTH_HEADER)).rejects.toMatchObject({
      problem: { status: 503 },
    });
  });

  it('throws a 503 ProblemException on a 5xx from analytics', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    const service = new ProjectAccessService(makeConfig());

    await expect(service.getProjectRole(PROJECT_ID, AUTH_HEADER)).rejects.toMatchObject({
      problem: { status: 503 },
    });
  });

  it('serves two calls within the TTL from cache — only ONE fetch is made', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { role: 'owner' }));
    const service = new ProjectAccessService(makeConfig());

    await expect(service.getProjectRole(PROJECT_ID, AUTH_HEADER)).resolves.toBe('owner');
    await expect(service.getProjectRole(PROJECT_ID, AUTH_HEADER)).resolves.toBe('owner');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the cache entry expires', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(jsonResponse(200, { role: 'owner' }));
      const service = new ProjectAccessService(makeConfig());

      await service.getProjectRole(PROJECT_ID, AUTH_HEADER);
      jest.advanceTimersByTime(5001);
      await service.getProjectRole(PROJECT_ID, AUTH_HEADER);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('caches per authHeader + projectId — a different project triggers its own fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { role: 'viewer' }));
    const service = new ProjectAccessService(makeConfig());

    await service.getProjectRole(PROJECT_ID, AUTH_HEADER);
    await service.getProjectRole('project-2', AUTH_HEADER);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
