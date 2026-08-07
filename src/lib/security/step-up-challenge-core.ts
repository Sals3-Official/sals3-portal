import { createHash, randomInt } from 'crypto';

/**
 * A short-lived, single-use verification code gate for a destructive-adjacent
 * action (e.g. disconnecting a supplier). This module only proves "the
 * caller typed the code we generated" - it does not send that code anywhere.
 * Delivery (real email OTP, SMS, or an admin passphrase) is a separate,
 * not-yet-wired concern - see the caller for why.
 *
 * In-memory by design, matching this codebase's existing
 * `CjTokenManager` cache pattern: a challenge is meant to be redeemed within
 * minutes by the same seller in the same server process, not persisted or
 * shared across instances. A multi-instance deployment would need this
 * backed by a shared store (e.g. the database) instead - revisit before
 * scaling past one server process.
 *
 * No `server-only` guard here on purpose (unlike `step-up-challenge.ts`,
 * the guarded re-export app code imports) - see `crypto-core.ts`'s own
 * comment for why: `server-only`'s default export throws unconditionally
 * outside Next's bundler condition, which breaks importing this module
 * directly from a Vitest test.
 */

const CODE_LENGTH = 6;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type Challenge = {
  codeHash: string;
  expiresAt: number;
  attempts: number;
};

const challenges = new Map<string, Challenge>();

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/**
 * Creates (or replaces) a pending challenge for `key` and returns the raw
 * code. The raw code is never stored - only its hash - and the caller is
 * responsible for getting it to the right person through a real channel.
 * Never log the return value.
 */
export function createStepUpChallenge(key: string): {
  code: string;
  expiresAt: Date;
} {
  const code = generateCode();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;

  challenges.set(key, { codeHash: hashCode(code), expiresAt, attempts: 0 });

  return { code, expiresAt: new Date(expiresAt) };
}

/**
 * Verifies `code` against the pending challenge for `key`. Single-use: a
 * correct code is consumed immediately. Locks out (deletes the challenge)
 * after `MAX_ATTEMPTS` wrong guesses rather than allowing unlimited retries
 * against a 6-digit space.
 */
export function verifyStepUpChallenge(key: string, code: string): boolean {
  const challenge = challenges.get(key);

  if (challenge === undefined) return false;

  if (Date.now() > challenge.expiresAt) {
    challenges.delete(key);
    return false;
  }

  challenge.attempts += 1;

  if (challenge.attempts > MAX_ATTEMPTS) {
    challenges.delete(key);
    return false;
  }

  if (challenge.codeHash !== hashCode(code)) {
    return false;
  }

  challenges.delete(key);
  return true;
}

/** Test/ops helper: drops a pending challenge without redeeming it. */
export function clearStepUpChallenge(key: string): void {
  challenges.delete(key);
}
