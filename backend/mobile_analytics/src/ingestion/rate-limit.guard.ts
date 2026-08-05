import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ProblemException } from '../common/problem-details';
import { SlidingWindowRateLimiter } from './rate-limiter';
import type { IngestRequest } from './ingest-auth';

/** Runs after SdkTokenGuard (decorator order in @UseGuards is preserved by Nest). */
@Injectable()
export class IngestRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: SlidingWindowRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IngestRequest>();
    const auth = req.ingestAuth;
    if (!auth) {
      throw new ProblemException({
        status: 401,
        title: 'Unauthorized',
        detail: 'Missing ingest authentication context',
      });
    }
    const result = await this.limiter.consume(
      `ingest:${auth.token}`,
      this.config.ingestRateLimitPerMin,
    );
    if (!result.allowed) {
      throw new ProblemException({
        status: 429,
        title: 'Too Many Requests',
        detail: `Rate limit of ${this.config.ingestRateLimitPerMin} requests per minute per token exceeded`,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    return true;
  }
}
