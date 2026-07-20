import { decodeCustomersCursor, encodeCustomersCursor } from './cursor';

describe('customers cursor', () => {
  it('round-trips createdAt + id through encode/decode', () => {
    const createdAt = new Date('2026-07-01T12:00:00.000Z');
    const id = '11111111-1111-1111-1111-111111111111';

    const encoded = encodeCustomersCursor({ createdAt, id });
    const decoded = decodeCustomersCursor(encoded);

    expect(decoded).toEqual({ createdAt, id });
  });

  it('produces an opaque, non-JSON-looking string', () => {
    const encoded = encodeCustomersCursor({ createdAt: new Date(), id: 'x' });
    expect(() => JSON.parse(encoded)).toThrow();
  });

  it('rejects a cursor that does not decode to valid JSON', () => {
    expect(() => decodeCustomersCursor('not-a-real-cursor!!!')).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });

  it('rejects a cursor missing required fields', () => {
    const bogus = Buffer.from(JSON.stringify({ createdAt: '2026-07-01T00:00:00.000Z' }), 'utf8').toString('base64');
    expect(() => decodeCustomersCursor(bogus)).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });

  it('rejects a cursor with an unparseable date', () => {
    const bogus = Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: 'x' }), 'utf8').toString('base64');
    expect(() => decodeCustomersCursor(bogus)).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });
});
