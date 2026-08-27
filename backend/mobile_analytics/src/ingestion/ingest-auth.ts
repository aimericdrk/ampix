import type { Request } from 'express';
import type { EventSource } from '@myampix/contracts';

export interface IngestAuthContext {
  projectId: string;
  token: string;
  /** Client vs server, taken from the token row — never from the request body. */
  source: EventSource;
  /**
   * Whether this token may erase end-user data (ErasureCapabilityGuard). Like `source`, it comes
   * from the token row and never from the request — a caller cannot ask for the capability.
   */
  canErase: boolean;
}

export interface IngestRequest extends Request {
  ingestAuth?: IngestAuthContext;
}
