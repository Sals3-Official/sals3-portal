import { getSessionCookie } from 'better-auth/cookies';
import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PREFIXES = [
  '/overview',
  '/orders',
  '/inventory',
  '/finances',
  '/payouts',
  '/market-rules',
  '/supplier-apps',
  '/products',
  '/listings',
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest) {
  if (!isProtectedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (process.env.PORTAL_TEST_AUTH_BYPASS === '1') {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request.headers);

  if (sessionCookie !== null) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set(
    'next',
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/overview/:path*',
    '/orders/:path*',
    '/inventory/:path*',
    '/finances/:path*',
    '/payouts/:path*',
    '/market-rules/:path*',
    '/supplier-apps/:path*',
    '/products/:path*',
    '/listings/:path*',
  ],
};
