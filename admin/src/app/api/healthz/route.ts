import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Unauthenticated probe endpoint. Liveness: GET /api/healthz → 200.
 * Readiness: GET /api/healthz?ready=1 additionally pings the admin database (503 when down).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const ready = new URL(req.url).searchParams.has('ready');
  if (!ready) return NextResponse.json({ status: 'ok' });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ready', checks: { postgres: true } });
  } catch {
    return NextResponse.json({ status: 'unavailable', checks: { postgres: false } }, { status: 503 });
  }
}
