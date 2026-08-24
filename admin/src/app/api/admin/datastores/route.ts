import { NextResponse } from 'next/server';
import { requireActiveApi } from '@/lib/api-guard';
import { loadEnv } from '@/lib/env';
import {
  probeClickHouse,
  probePostgres,
  probeRedis,
  type ClickHouseReport,
  type PostgresReport,
  type RedisReport,
} from '@/lib/datastores';

export const dynamic = 'force-dynamic';

export interface DatastoresPayload {
  adminPostgres: PostgresReport | null;
  analyticsPostgres: PostgresReport | null;
  purchasePostgres: PostgresReport | null;
  clickhouse: ClickHouseReport | null;
  redis: RedisReport | null;
}

export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  const env = loadEnv();
  const [adminPostgres, analyticsPostgres, purchasePostgres, clickhouse, redis] = await Promise.all([
    probePostgres(env.DATABASE_URL),
    probePostgres(env.ANALYTICS_DATABASE_URL),
    probePostgres(env.PURCHASE_DATABASE_URL),
    probeClickHouse(),
    probeRedis(),
  ]);
  const payload: DatastoresPayload = { adminPostgres, analyticsPostgres, purchasePostgres, clickhouse, redis };
  return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
}
