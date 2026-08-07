import 'server-only';

/**
 * App-facing entry point. `server-only` turns an accidental client import
 * into a build-time error, the same guard discipline `src/lib/db/client.ts`
 * already applies at runtime. The actual encryption logic lives in
 * `crypto-core.ts` (no guard) so the one-time bootstrap CLI script - which
 * never runs inside Next.js's bundler and therefore never gets the
 * `react-server` condition that makes `server-only` a no-op - can import it
 * directly without crashing on an unconditional throw.
 */
export * from './crypto-core';
