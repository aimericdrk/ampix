/** RFC 7807 problem details — the error shape of every MyAmpMix API response (contracts §7). */
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string[]>;
}

export class ApiError extends Error {
  readonly problem: ApiProblem;

  constructor(problem: ApiProblem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.problem = problem;
  }
}

/** Normalize any non-2xx Response into an ApiProblem, tolerating non-JSON bodies. */
export async function problemFromResponse(res: Response): Promise<ApiProblem> {
  const fallback: ApiProblem = {
    type: 'about:blank',
    title: res.statusText || 'Request failed',
    status: res.status,
  };

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return fallback;

  try {
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) return fallback;
    const raw = body as Record<string, unknown>;
    const problem: ApiProblem = {
      type: typeof raw.type === 'string' ? raw.type : 'about:blank',
      title: typeof raw.title === 'string' ? raw.title : fallback.title,
      status: typeof raw.status === 'number' ? raw.status : res.status,
    };
    if (typeof raw.detail === 'string') problem.detail = raw.detail;
    if (typeof raw.errors === 'object' && raw.errors !== null) {
      problem.errors = raw.errors as Record<string, string[]>;
    }
    return problem;
  } catch {
    return fallback;
  }
}
