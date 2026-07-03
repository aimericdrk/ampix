import { problemFromBodyParserError } from './json-body.middleware';

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
    expect(problemFromBodyParserError({ type: 'encoding.unsupported', status: 415 })).toMatchObject({
      status: 415,
      title: 'Unsupported Media Type',
    });
  });

  it('falls back to a 400 problem for unknown parser errors', () => {
    expect(problemFromBodyParserError(new Error('weird'))).toMatchObject({ status: 400, title: 'Bad Request' });
  });
});
