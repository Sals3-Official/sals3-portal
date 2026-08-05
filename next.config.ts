import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
