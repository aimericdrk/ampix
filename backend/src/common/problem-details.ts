import { HttpException } from '@nestjs/common';

/** RFC 7807 problem-details body (shared contracts §7 error shape). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: unknown;
  instance?: string;
}

export interface ProblemInit {
  status: number;
  title: string;
  detail?: string;
  type?: string;
  errors?: unknown;
  /** When set, the global filter adds a Retry-After response header (used for 429). */
  retryAfterSeconds?: number;
}

/** Throw this anywhere; the global ProblemDetailsFilter serializes it verbatim. */
export class ProblemException extends HttpException {
  readonly problem: ProblemDetails;
  readonly retryAfterSeconds?: number;

  constructor(init: ProblemInit) {
    const problem: ProblemDetails = {
      type: init.type ?? 'about:blank',
      title: init.title,
      status: init.status,
      ...(init.detail !== undefined && { detail: init.detail }),
      ...(init.errors !== undefined && { errors: init.errors }),
    };
    super(problem, init.status);
    this.problem = problem;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

export const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};
