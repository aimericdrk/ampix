import { ArgumentsHost, HttpException, NotFoundException } from '@nestjs/common';
import { ProblemException } from './problem-details';
import { ProblemDetailsFilter } from './problem-details.filter';

interface MockResponse {
  statusCode: number;
  contentType?: string;
  headers: Record<string, string>;
  body?: unknown;
  status(code: number): MockResponse;
  type(t: string): MockResponse;
  setHeader(name: string, value: string): void;
  send(body: unknown): MockResponse;
}

function mockHost(url = '/ingest/events'): { host: ArgumentsHost; res: MockResponse } {
  const res: MockResponse = {
    statusCode: 0,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    type(t) {
      this.contentType = t;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ originalUrl: url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();

  it('serializes a ProblemException as application/problem+json', () => {
    const { host, res } = mockHost();
    filter.catch(
      new ProblemException({ status: 401, title: 'Unauthorized', detail: 'bad token' }),
      host,
    );
    expect(res.statusCode).toBe(401);
    expect(res.contentType).toBe('application/problem+json');
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      detail: 'bad token',
      instance: '/ingest/events',
    });
  });

  it('sets Retry-After for problems carrying retryAfterSeconds', () => {
    const { host, res } = mockHost();
    filter.catch(
      new ProblemException({ status: 429, title: 'Too Many Requests', retryAfterSeconds: 12 }),
      host,
    );
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('12');
  });

  it('converts a plain HttpException', () => {
    const { host, res } = mockHost('/nope');
    filter.catch(new NotFoundException('Cannot GET /nope'), host);
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ status: 404, title: 'Not Found', detail: 'Cannot GET /nope' });
  });

  it('converts an HttpException with an object body', () => {
    const { host, res } = mockHost();
    filter.catch(new HttpException({ message: 'boom' }, 400), host);
    expect(res.body).toMatchObject({ status: 400, title: 'Bad Request', detail: 'boom' });
  });

  it('masks unknown errors as a 500 problem without leaking internals', () => {
    const { host, res } = mockHost();
    filter.catch(new Error('secret stack detail'), host);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      instance: '/ingest/events',
    });
  });
});
