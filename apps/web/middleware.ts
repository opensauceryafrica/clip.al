import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware. Deliberately LIGHT — it runs on the Edge runtime, so it does
 * NO database/Redis work (those need Node and happen in route handlers and the
 * (app)/(admin) layouts). It does three cheap things:
 *
 *   1. Per-request CSP nonce + security headers (§14.6) for HTML pages.
 *   2. Referrer-Policy default (the /r,/p hot paths set their own no-referrer
 *      and are EXCLUDED from this middleware by the matcher below — §9).
 *   3. A coarse auth gate: bounce logged-out users off protected prefixes by
 *      cookie presence. Authoritative JWT+revocation verification is server-side.
 */

const SESSION_COOKIE = 'clipal_session';
const PROTECTED_PREFIXES = ['/dashboard', '/links', '/settings', '/admin'];

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';
  const cdn = process.env['S3_PUBLIC_URL'] ?? '';
  // AdSense (§10) — only widen the policy when ads are actually enabled. The
  // interstitial's ad scripts carry the per-request nonce. NOTE(@owner): when
  // turning on AdSense, confirm the <ins>/push inline scripts are nonce-tagged.
  const adsOn = /^(1|true|yes|on)$/i.test(process.env['ADS_ENABLED'] ?? '');
  const adScript = adsOn
    ? ' https://pagead2.googlesyndication.com https://*.googlesyndication.com https://adservice.google.com https://www.googletagservices.com https://partner.googleadservices.com'
    : '';
  const adFrame = adsOn
    ? ' https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com'
    : '';
  const adImg = adsOn
    ? ' https://*.googlesyndication.com https://*.doubleclick.net https://www.google.com'
    : '';
  const adConnect = adsOn
    ? ' https://pagead2.googlesyndication.com https://*.google.com https://*.doubleclick.net'
    : '';
  const directives = [
    `default-src 'self'`,
    `script-src 'self' https://challenges.cloudflare.com 'nonce-${nonce}'${adScript}${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${cdn}${adImg}`.trim(),
    `font-src 'self'`,
    `frame-src https://challenges.cloudflare.com${adFrame}`,
    `connect-src 'self' https://challenges.cloudflare.com${adConnect}${isDev ? ' ws:' : ''}`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `manifest-src 'self'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ];
  return directives.join('; ');
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Coarse auth gate (cookie presence only).
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isProtected && !request.cookies.has(SESSION_COOKIE)) {
    // Middleware requires an ABSOLUTE Location (it does `new URL(location)`
    // internally — a relative path throws ERR_INVALID_URL). Build it from APP_URL,
    // NEVER from the request Host (`request.nextUrl`), which is a container
    // hostname behind Docker/a proxy. Read process.env directly to keep middleware
    // edge-light; fall back to the request origin only if APP_URL is unset (dev).
    const base = process.env.APP_URL || request.nextUrl.origin;
    const signinUrl = new URL('/signin', base);
    signinUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(signinUrl);
  }

  // CSP nonce. Next reads the nonce from the request-side CSP header and applies
  // it to its own bootstrap scripts automatically.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

export const config = {
  // Exclude the redirect/interstitial hot paths, Next internals, static files,
  // and the dependency-free /api/ping. Everything else gets CSP + the gate.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|r/|p/|api/ping).*)'],
};
