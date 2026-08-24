import { NextResponse } from 'next/server';
import { requireSessionApi } from '@/lib/auth';
import { assertSameOrigin, CrossOriginError } from '@/lib/origin';
import { UserManagementError } from '@/lib/users';
import type { ValidatedSession } from '@/lib/session';

/** Shared wrapper for mutating management routes: origin check + session + typed error mapping. */
export async function guardedMutation(
  req: Request,
  fn: (auth: NonNullable<ValidatedSession>) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
  } catch (e) {
    if (e instanceof CrossOriginError) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    throw e;
  }
  const auth = await requireSessionApi();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return await fn(auth);
  } catch (e) {
    if (e instanceof UserManagementError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
