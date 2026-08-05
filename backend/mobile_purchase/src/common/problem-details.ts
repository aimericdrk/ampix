import { HttpException } from '@nestjs/common';

/** RFC 7807 problem-details body — mirrors backend/src/common/problem-details.ts so both
 * MyAmpix services shape errors identically. */
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
}

/** Throw this anywhere; NestJS serializes the HttpException response body verbatim. */
export class ProblemException extends HttpException {
  readonly problem: ProblemDetails;

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
  }
}
