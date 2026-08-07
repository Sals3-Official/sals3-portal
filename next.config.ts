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
    // Allow-listed on purpose: only these CJdropshipping hosts may serve
    // product images. `src/lib/cj/schemas.ts` rejects any image address from
    // another host before it reaches a component, so the two lists must stay in
    // step.
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
