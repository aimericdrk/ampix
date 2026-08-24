import { NextRequest, NextResponse } from 'next/server';

/**
 * Cheap edge gate: pages without a session cookie go straight to /login. This is UX, not the
 * security boundary — every server component and API route re-validates the session against
 * Postgres via requireSession()/requireSessionApi() (middleware cannot run Prisma).
 */
export function middleware(req: NextRequest): NextResponse {
  const hasCookie = req.cookies.has('__Host-admx') || req.cookies.has('admx');
  const { pathname } = req.nextUrl;
  if (!hasCookie && pathname !== '/login') {
    // APIs answer 401 JSON; pages redirect to the login form.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  if (hasCookie && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }
  // Server components cannot read the request path; stamp it so the authed layout can gate
  // must-change-password users onto /account (design §3.7).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Everything except: auth endpoints the login flow itself needs, health probes, and static assets.
  matcher: ['/((?!api/auth/login|api/healthz|_next/static|_next/image|favicon.ico).*)'],
};
