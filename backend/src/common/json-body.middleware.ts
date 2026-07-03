import { json } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ProblemDetails, STATUS_TITLES } from './problem-details';

/** Maps express/body-parser errors to RFC 7807 problems (contracts §4: 400 malformed JSON, 413 too large). */
export function problemFromBodyParserError(err: unknown): ProblemDetails {
  const e = err as { type?: string; status?: number; message?: string };
  if (e.type === 'entity.too.large') {
    return {
      type: 'about:blank',
      title: 'Payload Too Large',
      status: 413,
      detail: 'Request body exceeds INGEST_MAX_BODY_KB',
    };
  }
  if (e.type === 'entity.parse.failed') {
    return {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Malformed JSON body',
    };
  }
  if (e.type === 'encoding.unsupported') {
    return {
      type: 'about:blank',
      title: 'Unsupported Media Type',
      status: 415,
      detail: 'Unsupported content encoding',
    };
  }
  const status = typeof e.status === 'number' ? e.status : 400;
  return {
    type: 'about:blank',
    title: STATUS_TITLES[status] ?? 'Bad Request',
    status,
    detail: 'Invalid request body',
  };
}

/**
 * JSON body parser with gzip support (`Content-Encoding: gzip` is inflated by body-parser)
 * and an RFC 7807 error path. Registered in main.ts with bodyParser disabled on the Nest app.
 */
export function jsonBodyParser(maxBodyKb: number): RequestHandler {
  const parser = json({ limit: `${maxBodyKb}kb`, inflate: true, type: 'application/json' });
  return (req: Request, res: Response, next: NextFunction) => {
    parser(req, res, (err?: unknown) => {
      if (!err) {
        next();
        return;
      }
      const problem: ProblemDetails = {
        ...problemFromBodyParserError(err),
        instance: req.originalUrl,
      };
      res.status(problem.status).type('application/problem+json').send(problem);
    });
  };
}
