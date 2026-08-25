import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { requireActiveApi } from '@/lib/api-guard';
import { BackupError, openBackup } from '@/lib/backups';

export const dynamic = 'force-dynamic';

/**
 * Streams one backup file. Streamed rather than buffered: dumps grow with the dataset and reading
 * one fully into memory would put the console's heap at the mercy of the database's size.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  const name = new URL(req.url).searchParams.get('name') ?? '';
  try {
    const { stream, sizeBytes } = await openBackup(name);
    return new NextResponse(Readable.toWeb(stream as Readable) as ReadableStream, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(sizeBytes),
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof BackupError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
