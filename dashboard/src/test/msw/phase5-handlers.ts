import { http, HttpResponse } from 'msw';
import type {
  AnalysisDefinition,
  AnalysisResult,
  Cohort,
  CohortDefinition,
  CohortPreviewResponse,
  CohortSummary,
  Dashboard,
  DashboardDataResponse,
  DashboardSummary,
  DashboardTile,
  FlowsResponse,
  FunnelResponse,
  InsightsResponse,
  ListCohortsResponse,
  ListDashboardsResponse,
  ListReportsResponse,
  RetentionResponse,
  ReportKind,
  SavedReport,
  SavedReportSummary,
} from '../../lib/api/types';

// Self-contained Phase-5 (§16) mock. It deliberately imports nothing from ./handlers to avoid a
// circular import (handlers.ts spreads `phase5Handlers` into its exported array). Seed data is keyed
// to PHASE5_SEED_PROJECT_ID, which mirrors TEST_PROJECT.id in ./handlers.

/** Must equal TEST_PROJECT.id in ./handlers (the fixture project every analytics test renders). */
export const PHASE5_SEED_PROJECT_ID = '0197f6a0-0000-7000-8000-0000000000aa';
const CREATED_BY = '0197f6a0-0000-7000-8000-000000000001';

export const TEST_COHORT_ID = 'cohort-seed-1';
export const TEST_REPORT_INSIGHTS_ID = 'report-seed-insights';
export const TEST_REPORT_FUNNEL_ID = 'report-seed-funnel';
export const TEST_DASHBOARD_ID = 'dashboard-seed-1';

// --- Deterministic per-kind analysis results (for /run + /data) ---

const INSIGHTS_RESULT: InsightsResponse = {
  series: [
    {
      name: 'checkout_completed',
      breakdown_value: null,
      data: [
        { t: '2026-06-29', value: 11 },
        { t: '2026-06-30', value: 13 },
        { t: '2026-07-01', value: 17 },
      ],
    },
  ],
};

const FUNNEL_RESULT: FunnelResponse = {
  steps: [
    { event: 'app_open', count: 900, conversion_from_prev: 1, conversion_from_top: 1 },
    { event: 'checkout_completed', count: 270, conversion_from_prev: 0.3, conversion_from_top: 0.3 },
  ],
  overall_conversion: 0.3,
};

const RETENTION_RESULT: RetentionResponse = {
  cohorts: [
    {
      cohort: '2026-06-01',
      size: 200,
      periods: [
        { period: 0, count: 200, rate: 1 },
        { period: 1, count: 120, rate: 0.6 },
      ],
    },
  ],
  averages: [
    { period: 0, rate: 1 },
    { period: 1, rate: 0.6 },
  ],
};

const FLOWS_RESULT: FlowsResponse = {
  nodes: [
    { id: '0:app_open', step: 0, event: 'app_open', value: 900 },
    { id: '1:browse', step: 1, event: 'browse', value: 500 },
    { id: '1:$end', step: 1, event: '$end', value: 400 },
  ],
  links: [
    { source: '0:app_open', target: '1:browse', value: 500 },
    { source: '0:app_open', target: '1:$end', value: 400 },
  ],
};

function resultForKind(kind: ReportKind): AnalysisResult {
  switch (kind) {
    case 'insights':
      return INSIGHTS_RESULT;
    case 'funnel':
      return FUNNEL_RESULT;
    case 'retention':
      return RETENTION_RESULT;
    case 'flows':
      return FLOWS_RESULT;
  }
}

const SEED_COHORT_DEFINITION: CohortDefinition = {
  match: 'all',
  conditions: [
    {
      type: 'behavior',
      event: 'checkout_completed',
      op: 'gte',
      count: 1,
      within_days: 30,
      filters: [],
    },
  ],
};

interface CohortRecord {
  id: string;
  projectId: string;
  name: string;
  definition: CohortDefinition;
  previewCount: number;
  previewSample: string[];
  createdAt: string;
  updatedAt: string;
}

interface ReportRecord {
  id: string;
  projectId: string;
  name: string;
  kind: ReportKind;
  definition: AnalysisDefinition;
  createdAt: string;
  updatedAt: string;
}

interface TileRecord {
  id: string;
  title: string;
  kind: ReportKind;
  savedReportId: string | null;
  inlineDefinition: AnalysisDefinition | null;
  x: number;
  y: number;
  w: number;
  h: number;
  position: number;
}

interface DashboardRecord {
  id: string;
  projectId: string;
  name: string;
  tiles: TileRecord[];
  createdAt: string;
  updatedAt: string;
}

interface Phase5State {
  cohorts: CohortRecord[];
  reports: ReportRecord[];
  dashboards: DashboardRecord[];
  nextId: number;
}

function initialState(): Phase5State {
  return {
    cohorts: [
      {
        id: TEST_COHORT_ID,
        projectId: PHASE5_SEED_PROJECT_ID,
        name: 'Recent buyers',
        definition: SEED_COHORT_DEFINITION,
        previewCount: 137,
        previewSample: ['user-001', 'user-004', 'user-009'],
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    reports: [
      {
        id: TEST_REPORT_INSIGHTS_ID,
        projectId: PHASE5_SEED_PROJECT_ID,
        name: 'Weekly checkouts',
        kind: 'insights',
        definition: {
          events: [{ name: 'checkout_completed', aggregation: 'total' }],
          date_range: { from: '2026-06-01', to: '2026-07-01' },
          interval: 'day',
          filters: [],
        },
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: TEST_REPORT_FUNNEL_ID,
        projectId: PHASE5_SEED_PROJECT_ID,
        name: 'Signup funnel',
        kind: 'funnel',
        definition: {
          steps: [
            { event: 'app_open', filters: [] },
            { event: 'checkout_completed', filters: [] },
          ],
          date_range: { from: '2026-06-01', to: '2026-07-01' },
          window_days: 7,
          order: 'any',
        },
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    dashboards: [
      {
        id: TEST_DASHBOARD_ID,
        projectId: PHASE5_SEED_PROJECT_ID,
        name: 'Growth overview',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        tiles: [
          {
            id: 'tile-seed-1',
            title: 'Checkouts',
            kind: 'insights',
            savedReportId: TEST_REPORT_INSIGHTS_ID,
            inlineDefinition: null,
            x: 0,
            y: 0,
            w: 6,
            h: 2,
            position: 0,
          },
          {
            id: 'tile-seed-2',
            title: 'Funnel',
            kind: 'funnel',
            savedReportId: TEST_REPORT_FUNNEL_ID,
            inlineDefinition: null,
            x: 6,
            y: 0,
            w: 6,
            h: 2,
            position: 1,
          },
        ],
      },
    ],
    nextId: 1,
  };
}

export const phase5State: Phase5State = initialState();

export function resetPhase5State(): void {
  const fresh = initialState();
  phase5State.cohorts = fresh.cohorts;
  phase5State.reports = fresh.reports;
  phase5State.dashboards = fresh.dashboards;
  phase5State.nextId = fresh.nextId;
}

function nextId(prefix: string): string {
  phase5State.nextId += 1;
  return `${prefix}-${phase5State.nextId}`;
}

const NOW = '2026-07-04T00:00:00.000Z';

function problem(status: number, title: string) {
  return HttpResponse.json(
    { type: 'about:blank', title, status },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

/** Any present bearer token is accepted — every test signs in before rendering a Phase-5 page. */
function unauthorized(request: Request): boolean {
  const header = request.headers.get('Authorization');
  return !header?.startsWith('Bearer ');
}

function toCohortSummary(record: CohortRecord): CohortSummary {
  return {
    id: record.id,
    name: record.name,
    created_by: CREATED_BY,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function toCohort(record: CohortRecord): Cohort {
  return { ...toCohortSummary(record), definition: record.definition };
}

function toReportSummary(record: ReportRecord): SavedReportSummary {
  return { id: record.id, name: record.name, kind: record.kind, created_by: CREATED_BY, updated_at: record.updatedAt };
}

function toReport(record: ReportRecord): SavedReport {
  return {
    id: record.id,
    name: record.name,
    created_by: CREATED_BY,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    kind: record.kind,
    definition: record.definition,
  } as SavedReport;
}

function toTile(record: TileRecord): DashboardTile {
  return {
    id: record.id,
    title: record.title,
    kind: record.kind,
    saved_report_id: record.savedReportId,
    inline_definition: record.inlineDefinition,
    x: record.x,
    y: record.y,
    w: record.w,
    h: record.h,
    position: record.position,
  };
}

function toDashboardSummary(record: DashboardRecord): DashboardSummary {
  return {
    id: record.id,
    name: record.name,
    tile_count: record.tiles.length,
    updated_at: record.updatedAt,
  };
}

function toDashboard(record: DashboardRecord): Dashboard {
  const tiles = [...record.tiles]
    .sort((a, b) => a.position - b.position)
    .map(toTile);
  return { id: record.id, name: record.name, tiles };
}

function cohortById(id: string): CohortRecord | undefined {
  return phase5State.cohorts.find((c) => c.id === id);
}
function reportById(id: string): ReportRecord | undefined {
  return phase5State.reports.find((r) => r.id === id);
}
function dashboardById(id: string): DashboardRecord | undefined {
  return phase5State.dashboards.find((d) => d.id === id);
}

const V1 = '/api/v1/projects/:projectId';

export const phase5Handlers = [
  // --- Cohorts (§16) ---

  http.get(`${V1}/cohorts`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const cohorts = phase5State.cohorts
      .filter((c) => c.projectId === projectId)
      .map(toCohortSummary);
    return HttpResponse.json({ cohorts } satisfies ListCohortsResponse);
  }),

  http.post(`${V1}/cohorts`, async ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { name?: string; definition?: CohortDefinition };
    if (!body.name?.trim() || !body.definition) return problem(400, 'Invalid cohort definition');
    const record: CohortRecord = {
      id: nextId('cohort'),
      projectId: params.projectId as string,
      name: body.name.trim(),
      definition: body.definition,
      previewCount: body.definition.conditions.length * 25,
      previewSample: ['user-001', 'user-002', 'user-003'],
      createdAt: NOW,
      updatedAt: NOW,
    };
    phase5State.cohorts.push(record);
    return HttpResponse.json(toCohort(record), { status: 201 });
  }),

  http.get(`${V1}/cohorts/:id/preview`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = cohortById(params.id as string);
    if (!record) return problem(404, 'Cohort not found');
    return HttpResponse.json({
      count: record.previewCount,
      sample: record.previewSample,
    } satisfies CohortPreviewResponse);
  }),

  http.get(`${V1}/cohorts/:id`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = cohortById(params.id as string);
    if (!record) return problem(404, 'Cohort not found');
    return HttpResponse.json(toCohort(record));
  }),

  http.patch(`${V1}/cohorts/:id`, async ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = cohortById(params.id as string);
    if (!record) return problem(404, 'Cohort not found');
    const body = (await request.json()) as { name?: string; definition?: CohortDefinition };
    if (body.name?.trim()) record.name = body.name.trim();
    if (body.definition) record.definition = body.definition;
    record.updatedAt = NOW;
    return HttpResponse.json(toCohort(record));
  }),

  http.delete(`${V1}/cohorts/:id`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const id = params.id as string;
    if (!cohortById(id)) return problem(404, 'Cohort not found');
    phase5State.cohorts = phase5State.cohorts.filter((c) => c.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Saved reports (§16) ---

  http.get(`${V1}/reports`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind');
    const reports = phase5State.reports
      .filter((r) => r.projectId === projectId && (!kind || r.kind === kind))
      .map(toReportSummary);
    return HttpResponse.json({ reports } satisfies ListReportsResponse);
  }),

  http.post(`${V1}/reports`, async ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as {
      name?: string;
      kind?: ReportKind;
      definition?: AnalysisDefinition;
    };
    if (!body.name?.trim() || !body.kind || !body.definition) {
      return problem(400, 'Invalid report definition');
    }
    const record: ReportRecord = {
      id: nextId('report'),
      projectId: params.projectId as string,
      name: body.name.trim(),
      kind: body.kind,
      definition: body.definition,
      createdAt: NOW,
      updatedAt: NOW,
    };
    phase5State.reports.push(record);
    return HttpResponse.json(toReport(record), { status: 201 });
  }),

  http.post(`${V1}/reports/:id/run`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = reportById(params.id as string);
    if (!record) return problem(404, 'Report not found');
    return HttpResponse.json(resultForKind(record.kind));
  }),

  http.get(`${V1}/reports/:id`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = reportById(params.id as string);
    if (!record) return problem(404, 'Report not found');
    return HttpResponse.json(toReport(record));
  }),

  http.patch(`${V1}/reports/:id`, async ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = reportById(params.id as string);
    if (!record) return problem(404, 'Report not found');
    const body = (await request.json()) as { name?: string; definition?: AnalysisDefinition };
    if (body.name?.trim()) record.name = body.name.trim();
    if (body.definition) record.definition = body.definition;
    record.updatedAt = NOW;
    return HttpResponse.json(toReport(record));
  }),

  http.delete(`${V1}/reports/:id`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const id = params.id as string;
    if (!reportById(id)) return problem(404, 'Report not found');
    phase5State.reports = phase5State.reports.filter((r) => r.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Custom dashboards (§16) ---

  http.get(`${V1}/dashboards`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const projectId = params.projectId as string;
    const dashboards = phase5State.dashboards
      .filter((d) => d.projectId === projectId)
      .map(toDashboardSummary);
    return HttpResponse.json({ dashboards } satisfies ListDashboardsResponse);
  }),

  http.post(`${V1}/dashboards`, async ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { name?: string };
    if (!body.name?.trim()) return problem(400, 'Dashboard name is required');
    const record: DashboardRecord = {
      id: nextId('dashboard'),
      projectId: params.projectId as string,
      name: body.name.trim(),
      tiles: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    phase5State.dashboards.push(record);
    return HttpResponse.json(toDashboardSummary(record), { status: 201 });
  }),

  http.get(`${V1}/dashboards/:id/data`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = dashboardById(params.id as string);
    if (!record) return problem(404, 'Dashboard not found');
    const tiles = [...record.tiles]
      .sort((a, b) => a.position - b.position)
      .map((tile) => ({ id: tile.id, result: resultForKind(tile.kind) }));
    return HttpResponse.json({ tiles } satisfies DashboardDataResponse);
  }),

  http.get(`${V1}/dashboards/:id`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = dashboardById(params.id as string);
    if (!record) return problem(404, 'Dashboard not found');
    return HttpResponse.json(toDashboard(record));
  }),

  http.patch(`${V1}/dashboards/:id/layout`, async ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = dashboardById(params.id as string);
    if (!record) return problem(404, 'Dashboard not found');
    const body = (await request.json()) as {
      tiles?: { id: string; x: number; y: number; w: number; h: number; position: number }[];
    };
    for (const patch of body.tiles ?? []) {
      const tile = record.tiles.find((t) => t.id === patch.id);
      if (tile) {
        tile.x = patch.x;
        tile.y = patch.y;
        tile.w = patch.w;
        tile.h = patch.h;
        tile.position = patch.position;
      }
    }
    record.updatedAt = NOW;
    return HttpResponse.json(toDashboard(record));
  }),

  http.post(`${V1}/dashboards/:id/tiles`, async ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = dashboardById(params.id as string);
    if (!record) return problem(404, 'Dashboard not found');
    const body = (await request.json()) as {
      title?: string;
      kind?: ReportKind;
      saved_report_id?: string;
      inline_definition?: AnalysisDefinition;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
    };
    if (!body.title?.trim() || !body.kind) return problem(400, 'Invalid tile');
    const tile: TileRecord = {
      id: nextId('tile'),
      title: body.title.trim(),
      kind: body.kind,
      savedReportId: body.saved_report_id ?? null,
      inlineDefinition: body.inline_definition ?? null,
      x: body.x ?? 0,
      y: body.y ?? 0,
      w: body.w ?? 6,
      h: body.h ?? 2,
      position: record.tiles.length,
    };
    record.tiles.push(tile);
    record.updatedAt = NOW;
    return HttpResponse.json(toTile(tile), { status: 201 });
  }),

  http.patch(`${V1}/dashboards/:id/tiles/:tileId`, async ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = dashboardById(params.id as string);
    if (!record) return problem(404, 'Dashboard not found');
    const tile = record.tiles.find((t) => t.id === (params.tileId as string));
    if (!tile) return problem(404, 'Tile not found');
    const body = (await request.json()) as {
      title?: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
    };
    if (body.title?.trim()) tile.title = body.title.trim();
    if (typeof body.x === 'number') tile.x = body.x;
    if (typeof body.y === 'number') tile.y = body.y;
    if (typeof body.w === 'number') tile.w = body.w;
    if (typeof body.h === 'number') tile.h = body.h;
    record.updatedAt = NOW;
    return HttpResponse.json(toTile(tile));
  }),

  http.delete(`${V1}/dashboards/:id/tiles/:tileId`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = dashboardById(params.id as string);
    if (!record) return problem(404, 'Dashboard not found');
    const tileId = params.tileId as string;
    record.tiles = record.tiles.filter((t) => t.id !== tileId);
    record.updatedAt = NOW;
    return new HttpResponse(null, { status: 204 });
  }),

  http.patch(`${V1}/dashboards/:id`, async ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const record = dashboardById(params.id as string);
    if (!record) return problem(404, 'Dashboard not found');
    const body = (await request.json()) as { name?: string };
    if (body.name?.trim()) record.name = body.name.trim();
    record.updatedAt = NOW;
    return HttpResponse.json(toDashboardSummary(record));
  }),

  http.delete(`${V1}/dashboards/:id`, ({ request, params }) => {
    if (unauthorized(request)) return problem(401, 'Access token invalid or expired');
    const id = params.id as string;
    if (!dashboardById(id)) return problem(404, 'Dashboard not found');
    phase5State.dashboards = phase5State.dashboards.filter((d) => d.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),
];
