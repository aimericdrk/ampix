/** Next.js server-start hook: boots the metric sampler (v2 design Phase 3). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DATABASE_URL) {
    const { startSampler } = await import('./lib/sampler');
    startSampler();
  }
}
