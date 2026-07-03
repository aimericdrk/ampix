import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProblemDetails, ProblemException, STATUS_TITLES } from './problem-details';

/** Global exception filter: every error leaves the API as RFC 7807 application/problem+json. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const problem = this.toProblem(exception);
    problem.instance = req.originalUrl;

    if (exception instanceof ProblemException && exception.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }
    if (problem.status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }

    res.status(problem.status).type('application/problem+json').send(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ProblemException) {
      return { ...exception.problem };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const title = STATUS_TITLES[status] ?? exception.message;
      let detail: string | undefined;
      if (typeof body === 'string') {
        detail = body;
      } else {
        const message = (body as { message?: string | string[] }).message;
        detail = Array.isArray(message) ? message.join('; ') : message;
      }
      return {
        type: 'about:blank',
        title,
        status,
        ...(detail !== undefined && detail !== title && { detail }),
      };
    }
    return { type: 'about:blank', title: 'Internal Server Error', status: 500 };
  }
}
