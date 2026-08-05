import type { Request } from 'express';

export interface IngestAuthContext {
  projectId: string;
  token: string;
}

export interface IngestRequest extends Request {
  ingestAuth?: IngestAuthContext;
}
