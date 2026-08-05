import { ProblemException } from '../../common/problem-details';

export interface CustomersCursor {
  createdAt: Date;
  id: string;
}

/** Opaque keyset-pagination cursor: base64-encodes `{createdAt, id}` — the tie-breaking pair the
 * customers LIST orders by (`createdAt DESC, id DESC`, design §1.3). Never inspected by the
 * client; round-tripped verbatim from a page's `nextCursor` back into the next request's
 * `?cursor=`. */
export function encodeCustomersCursor(cursor: CustomersCursor): string {
  const payload = JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64');
}

/** Decodes + validates a cursor produced by `encodeCustomersCursor`. Throws a 400 RFC-7807
 * problem for anything malformed — the dashboard never constructs this by hand, but a
 * tampered/stale `?cursor=` must fail closed, not silently misbehave (input validation at the
 * system boundary). */
export function decodeCustomersCursor(raw: string): CustomersCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).createdAt !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string'
  ) {
    throw invalidCursor();
  }
  const { createdAt, id } = parsed as { createdAt: string; id: string };
  const parsedDate = new Date(createdAt);
  if (Number.isNaN(parsedDate.getTime())) {
    throw invalidCursor();
  }
  return { createdAt: parsedDate, id };
}

function invalidCursor(): ProblemException {
  return new ProblemException({ status: 400, title: 'Bad Request', detail: 'cursor: invalid cursor' });
}
