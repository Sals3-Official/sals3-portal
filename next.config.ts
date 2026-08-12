import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
    ];

    const authPageHeaders = [
      ...securityHeaders,
      {
        key: 'Cache-Control',
        value: 'no-store, max-age=0',
      },
    ];

    return [
      { source: '/login', headers: authPageHeaders },
      { source: '/signup', headers: authPageHeaders },
      { source: '/reset-password', headers: authPageHeaders },
      { source: '/setup-2fa', headers: authPageHeaders },
      { source: '/two-factor', headers: authPageHeaders },
      { source: '/auth/pending', headers: authPageHeaders },
      {
        source: '/api/auth/:path*',
        headers: securityHeaders,
      },
    ];
  },
  images: {
    // Every image goes through `src/lib/images/cj-image-loader.ts` instead of
    // Vercel's metered `/_next/image` optimizer, which answered `402
    // OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED` to every request once the
    // account's Image Optimization allowance ran out (verified against
    // production 2026-08-13) and broke every image in the portal. The loader
    // hands resizing to CJ's own CDN for free; read its header comment for the
    // measurements and for what it deliberately does not do.
    loader: 'custom',
    loaderFile: './src/lib/images/cj-image-loader.ts',
    // Allow-listed on purpose: only these CJdropshipping hosts may serve
    // product images. `src/lib/cj/schemas.ts` rejects any image address from
    // another host before it reaches a component, so the two lists must stay in
    // step.
    //
    // This list no longer gates anything at request time - a custom loader
    // bypasses the optimizer that enforces it. It is kept because it documents
    // the same allow-list the code enforces, and because removing it would
    // silently re-open the whole internet the moment anyone drops `loader:
    // 'custom'`. The enforcing gate is `cjImageUrl` in
    // `src/lib/cj/primitives.ts`, which runs at intake.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cf.cjdropshipping.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'oss-cf.cjdropshipping.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
