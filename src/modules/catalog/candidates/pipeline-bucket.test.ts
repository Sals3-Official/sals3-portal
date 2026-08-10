import { describe, expect, it } from 'vitest';
import { EVALUATION_STATUSES } from './rules/contracts';
import { MAX_EVALUATION_ATTEMPTS } from './rules/policy';
import { classifyPipelineBucket, PIPELINE_BUCKETS } from './pipeline-bucket';

describe('classifyPipelineBucket', () => {
  it('assigns every status a bucket, at every attempt count, with no gaps', () => {
    const attemptCounts = [
      0,
      1,
      MAX_EVALUATION_ATTEMPTS - 1,
      MAX_EVALUATION_ATTEMPTS,
      MAX_EVALUATION_ATTEMPTS + 1,
    ];

    EVALUATION_STATUSES.forEach((status) => {
      attemptCounts.forEach((attemptCount) => {
        const bucket = classifyPipelineBucket(status, attemptCount);

        expect(PIPELINE_BUCKETS).toContain(bucket);
      });
    });
  });

  it('is independent of attemptCount for every status except EVALUATION_FAILED', () => {
    const stableStatuses = EVALUATION_STATUSES.filter(
      (status) => status !== 'EVALUATION_FAILED',
    );

    stableStatuses.forEach((status) => {
      const atZero = classifyPipelineBucket(status, 0);
      const atMax = classifyPipelineBucket(status, MAX_EVALUATION_ATTEMPTS + 5);

      expect(atZero).toBe(atMax);
    });
  });

  it('routes a mid-retry EVALUATION_FAILED row to evaluating, not nowhere', () => {
    expect(classifyPipelineBucket('EVALUATION_FAILED', 0)).toBe('evaluating');
    expect(
      classifyPipelineBucket('EVALUATION_FAILED', MAX_EVALUATION_ATTEMPTS - 1),
    ).toBe('evaluating');
  });

  it('routes an exhausted EVALUATION_FAILED row to the exception queue', () => {
    expect(
      classifyPipelineBucket('EVALUATION_FAILED', MAX_EVALUATION_ATTEMPTS),
    ).toBe('exceptionQueue');
    expect(
      classifyPipelineBucket('EVALUATION_FAILED', MAX_EVALUATION_ATTEMPTS + 3),
    ).toBe('exceptionQueue');
  });

  it('maps every other status to its documented bucket', () => {
    expect(classifyPipelineBucket('PASS', 0)).toBe('ready');
    expect(classifyPipelineBucket('PASS_WITH_ATTENTION', 0)).toBe(
      'needsAttention',
    );
    expect(classifyPipelineBucket('QUEUED', 0)).toBe('evaluating');
    expect(classifyPipelineBucket('EVALUATING', 0)).toBe('evaluating');
    expect(classifyPipelineBucket('BLOCKED', 0)).toBe('blockedRejected');
    expect(classifyPipelineBucket('TEMPORARILY_INELIGIBLE', 0)).toBe(
      'blockedRejected',
    );
  });
});
