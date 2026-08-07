import { describe, expect, it } from 'vitest';
import { decide } from './decide';
import type { RuleFinding } from './contracts';

function finding(overrides: Partial<RuleFinding>): RuleFinding {
  return { reasonCode: 'NO_STOCK', severity: 'ATTENTION', ...overrides };
}

describe('decide', () => {
  it('passes with no reasons when there are no findings', () => {
    expect(decide([])).toEqual({ status: 'PASS', reasonCodes: [] });
  });

  it('passes with attention when only ATTENTION findings exist', () => {
    const result = decide([
      finding({ severity: 'ATTENTION', reasonCode: 'ABNORMAL_PRICE_CHANGE' }),
    ]);

    expect(result).toEqual({
      status: 'PASS_WITH_ATTENTION',
      reasonCodes: ['ABNORMAL_PRICE_CHANGE'],
    });
  });

  it('blocks permanently on a permanent reason code (POLICY_BLOCKED)', () => {
    const result = decide([
      finding({ severity: 'BLOCK', reasonCode: 'POLICY_BLOCKED' }),
    ]);

    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCodes).toEqual(['POLICY_BLOCKED']);
  });

  it('is temporarily ineligible on a transient reason code (NO_STOCK)', () => {
    const result = decide([
      finding({ severity: 'BLOCK', reasonCode: 'NO_STOCK' }),
    ]);

    expect(result.status).toBe('TEMPORARILY_INELIGIBLE');
  });

  it('escalates to BLOCKED when any blocking reason is permanent, even alongside a transient one', () => {
    const result = decide([
      finding({ severity: 'BLOCK', reasonCode: 'NO_STOCK' }),
      finding({ severity: 'BLOCK', reasonCode: 'COUNTERFEIT_HIGH_CONFIDENCE' }),
    ]);

    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['NO_STOCK', 'COUNTERFEIT_HIGH_CONFIDENCE']),
    );
  });

  it('deduplicates repeated reason codes', () => {
    const result = decide([
      finding({ severity: 'BLOCK', reasonCode: 'NO_STOCK' }),
      finding({ severity: 'BLOCK', reasonCode: 'NO_STOCK' }),
    ]);

    expect(result.reasonCodes).toEqual(['NO_STOCK']);
  });

  it('ignores ATTENTION findings once a BLOCK finding is present', () => {
    const result = decide([
      finding({ severity: 'BLOCK', reasonCode: 'POLICY_BLOCKED' }),
      finding({ severity: 'ATTENTION', reasonCode: 'ABNORMAL_PRICE_CHANGE' }),
    ]);

    expect(result.status).toBe('BLOCKED');
    expect(result.reasonCodes).toEqual(['POLICY_BLOCKED']);
  });
});
