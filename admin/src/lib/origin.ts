/**
 * CSRF defense-in-depth (design §3.6): every mutating route handler must call assertSameOrigin.
 * SameSite=Lax already blocks cross-site POST cookies in modern browsers; this check refuses the
 * request outright when Origin (or, failing that, Referer) does not match the request's own host.
 */
export class CrossOriginError extends Error {
  constructor() {
    super('cross-origin request refused');
  }
}

export function assertSameOrigin(req: Request): void {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) throw new CrossOriginError();
  const origin = req.headers.get('origin') ?? req.headers.get('referer');
  // Mutations must carry an Origin or Referer; absence is a refusal, not a pass.
  if (!origin) throw new CrossOriginError();
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new CrossOriginError();
  }
  if (originHost !== host) throw new CrossOriginError();
}
