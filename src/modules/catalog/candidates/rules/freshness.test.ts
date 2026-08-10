import { describe, expect, it } from 'vitest';
import { nextRefreshAtFor } from './policy';

const NOW = new Date('2026-08-11T00:00:00Z');
const HOUR_MS = 60 * 60 * 1000;

describe('nextRefreshAtFor - freshness tiers (ADR-010 §12.2)', () => {
  it('qualified-but-unselected decisions refresh within 72 hours', () => {
    (['PASS', 'PASS_WITH_ATTENTION'] as const).forEach((status) => {
      expect(nextRefreshAtFor(status, NOW)?.getTime()).toBe(
        NOW.getTime() + 72 * HOUR_MS,
      );
    });
  });

  it('operational nonterminal decisions reconcile within 30 days - even an exhausted dead letter keeps a floor', () => {
    (['TEMPORARILY_INELIGIBLE', 'EVALUATION_FAILED'] as const).forEach(
      (status) => {
        expect(nextRefreshAtFor(status, NOW)?.getTime()).toBe(
          NOW.getTime() + 30 * 24 * HOUR_MS,
        );
      },
    );
  });

  it('permanent policy blocks carry NO clock - they re-evaluate only on a supplier data or policy/evidence version change', () => {
    expect(nextRefreshAtFor('BLOCKED', NOW)).toBeNull();
  });

  it('in-flight states carry no refresh deadline of their own', () => {
    expect(nextRefreshAtFor('QUEUED', NOW)).toBeNull();
    expect(nextRefreshAtFor('EVALUATING', NOW)).toBeNull();
  });
});
