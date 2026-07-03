import { describe, expect, it } from 'vitest';
import { ApiError, problemFromResponse } from './problem';

function jsonResponse(body: unknown, status: number, contentType = 'application/problem+json') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType },
  });
}

describe('problemFromResponse', () => {
  it('parses a full RFC 7807 body', async () => {
    const problem = await problemFromResponse(
      jsonResponse(
        {
          type: 'https://myampmix.dev/problems/validation',
          title: 'Validation failed',
          status: 400,
          detail: 'Two fields are invalid.',
          errors: { email: ['must be a valid email'] },
        },
        400,
      ),
    );
    expect(problem).toEqual({
      type: 'https://myampmix.dev/problems/validation',
      title: 'Validation failed',
      status: 400,
      detail: 'Two fields are invalid.',
      errors: { email: ['must be a valid email'] },
    });
  });

  it('normalizes a minimal problem body', async () => {
    const problem = await problemFromResponse(
      jsonResponse({ type: 'about:blank', title: 'Unauthorized', status: 401 }, 401),
    );
    expect(problem.status).toBe(401);
    expect(problem.title).toBe('Unauthorized');
    expect(problem.detail).toBeUndefined();
  });

  it('falls back for non-JSON responses (e.g. proxy HTML)', async () => {
    const res = new Response('<html>Bad Gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'Content-Type': 'text/html' },
    });
    const problem = await problemFromResponse(res);
    expect(problem).toEqual({ type: 'about:blank', title: 'Bad Gateway', status: 502 });
  });

  it('falls back for malformed JSON', async () => {
    const res = new Response('{not json', {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'Content-Type': 'application/json' },
    });
    const problem = await problemFromResponse(res);
    expect(problem.status).toBe(500);
    expect(problem.title).toBe('Internal Server Error');
  });
});

describe('ApiError', () => {
  it('uses detail as message when present, otherwise title', () => {
    const withDetail = new ApiError({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'Email already registered',
    });
    expect(withDetail.message).toBe('Email already registered');
    expect(withDetail.problem.status).toBe(409);
    expect(withDetail.name).toBe('ApiError');

    const withoutDetail = new ApiError({ type: 'about:blank', title: 'Unauthorized', status: 401 });
    expect(withoutDetail.message).toBe('Unauthorized');
  });
});
