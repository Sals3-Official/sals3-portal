import { describe, expect, it } from 'vitest';
import { nextRefreshAtFor } from './policy';

/**
 * Lean intake policy (ADR-013 §1a, owner decision 2026-08-12): the passive
 * evidence-refresh clock is retired for raw All Supplier Products rows.
 *
 * The 72-hour and 30-day tiers existed to re-reconcile CJ EVIDENCE, and raw
 * intake no longer fetches any. Re-running local screening on a timer would
 * re-derive the identical answer from identical inputs, for the whole
 * catalogue, forever. Both real triggers stay event-driven and implemented:
 * a supplier data change (fingerprint requeue at ingestion, and the webhook
 * source-change path) and a policy version change (the sweep's
 * `requeuePolicyVersionMismatches`, which re-evaluates unchanged rows
 * including `BLOCKED`).
 */
describe('nextRefreshAtFor under the lean intake policy', () => {
  it('sets no passive refresh clock for any decided status', () => {
    (
      [
        'PASS',
        'PASS_WITH_ATTENTION',
        'TEMPORARILY_INELIGIBLE',
        'EVALUATION_FAILED',
        'BLOCKED',
      ] as const
    ).forEach((status) => {
      expect(nextRefreshAtFor(status)).toBeNull();
    });
  });

  it('sets no refresh deadline for in-flight states either', () => {
    expect(nextRefreshAtFor('QUEUED')).toBeNull();
    expect(nextRefreshAtFor('EVALUATING')).toBeNull();
  });

  it('takes no clock argument at all - there is no timer left to offset', () => {
    expect(nextRefreshAtFor.length).toBe(1);
  });
});
