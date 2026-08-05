import express from 'express';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { jsonBodyParser, problemFromBodyParserError } from './json-body.middleware';

describe('problemFromBodyParserError', () => {
  it('maps entity.too.large to a 413 problem', () => {
    expect(problemFromBodyParserError({ type: 'entity.too.large', status: 413 })).toEqual({
      type: 'about:blank',
      title: 'Payload Too Large',
      status: 413,
      detail: 'Request body exceeds INGEST_MAX_BODY_KB',
    });
  });

  it('maps entity.parse.failed to a 400 problem', () => {
    expect(problemFromBodyParserError({ type: 'entity.parse.failed', status: 400 })).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Malformed JSON body',
    });
  });

  it('maps encoding.unsupported to a 415 problem', () => {
    expect(problemFromBodyParserError({ type: 'encoding.unsupported', status: 415 })).toMatchObject(
      {
        status: 415,
        title: 'Unsupported Media Type',
      },
    );
  });

  it('falls back to a 400 problem for unknown parser errors', () => {
    expect(problemFromBodyParserError(new Error('weird'))).toMatchObject({
      status: 400,
      title: 'Bad Request',
    });
  });
});

describe('jsonBodyParser', () => {
  function appWith(maxBodyKb: number): express.Express {
    const app = express();
    app.use(jsonBodyParser(maxBodyKb));
    app.post('/echo', (req, res) => {
      res.status(200).json({ received: req.body });
    });
    return app;
  }

  it('parses a plain JSON body and calls next()', async () => {
    const res = await request(appWith(1)).post('/echo').send({ hello: 'world', n: 42 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: { hello: 'world', n: 42 } });
  });

  it('inflates a gzip-compressed JSON body identically', async () => {
    const payload = { hello: 'world', n: 42 };
    const res = await request(appWith(1))
      .post('/echo')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      // Bypass superagent's JSON serializer so the raw gzip bytes are sent unmodified.
      .serialize((body) => body as string)
      .send(gzipSync(Buffer.from(JSON.stringify(payload))));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: payload });
  });

  it('rejects a body exceeding maxBodyKb with a 413 problem', async () => {
    const res = await request(appWith(1))
      .post('/echo')
      .send({ padding: 'x'.repeat(2048) });
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Payload Too Large',
      status: 413,
      detail: 'Request body exceeds INGEST_MAX_BODY_KB',
      instance: '/echo',
    });
  });

  it('rejects malformed JSON with a 400 problem', async () => {
    const res = await request(appWith(1))
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Malformed JSON body',
      instance: '/echo',
    });
  });
});
