import { toNextJsHandler } from 'better-auth/next-js';
import getAuth from '@/lib/auth/server';

export const runtime = 'nodejs';

// Resolve the instance per request, not at module evaluation: `next build`
// imports this module while collecting page data, where DATABASE_URL is not
// guaranteed to exist.
export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(
  (request: Request) => getAuth().handler(request),
);
