import type { Request } from 'express';
import type { IngestSource } from '@myampix/contracts';

export interface IngestAuthContext {
  projectId: string;
  token: string;
  /** Client vs server, taken from the token row — never from the request body. */
  source: IngestSource;
}

export interface IngestRequest extends Request {
  ingestAuth?: IngestAuthContext;
}
