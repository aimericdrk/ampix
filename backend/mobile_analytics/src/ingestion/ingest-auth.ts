import type { Request } from 'express';
import type { EventSource } from '@myampix/contracts';

export interface IngestAuthContext {
  projectId: string;
  token: string;
  /** Client vs server, taken from the token row — never from the request body. */
  source: EventSource;
}

export interface IngestRequest extends Request {
  ingestAuth?: IngestAuthContext;
}
