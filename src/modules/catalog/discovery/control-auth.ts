import { createHash, timingSafeEqual } from 'crypto';

/**
 * Authentication for the internal discovery control routes: a dedicated
 * server-only control secret (`DISCOVERY_CONTROL_SECRET`), compared in
 * constant time. Both values are hashed to a fixed width before comparison
 * so a length mismatch can neither throw nor leak timing. Fails closed when
 * the secret is unset.
 */
export default function isDiscoveryControlAuthorized(
  authorizationHeader: string | null,
): boolean {
  const secret = process.env.DISCOVERY_CONTROL_SECRET;

  if (secret === undefined || secret.trim() === '') return false;
  if (authorizationHeader === null) return false;

  const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
  const provided = createHash('sha256').update(authorizationHeader).digest();

  return timingSafeEqual(expected, provided);
}
