import { describe, expect, it } from 'vitest';
import {
  clearStepUpChallenge,
  createStepUpChallenge,
  verifyStepUpChallenge,
} from './step-up-challenge-core';

describe('step-up challenge', () => {
  it('accepts the correct code once', () => {
    const key = `test:${crypto.randomUUID()}`;
    const { code } = createStepUpChallenge(key);

    expect(verifyStepUpChallenge(key, code)).toBe(true);
  });

  it('is single-use: the same code fails on a second attempt', () => {
    const key = `test:${crypto.randomUUID()}`;
    const { code } = createStepUpChallenge(key);

    expect(verifyStepUpChallenge(key, code)).toBe(true);
    expect(verifyStepUpChallenge(key, code)).toBe(false);
  });

  it('rejects a wrong code', () => {
    const key = `test:${crypto.randomUUID()}`;
    createStepUpChallenge(key);

    expect(verifyStepUpChallenge(key, '000000')).toBe(false);
  });

  it('rejects a code for a key with no pending challenge', () => {
    expect(verifyStepUpChallenge(`test:${crypto.randomUUID()}`, '123456')).toBe(
      false,
    );
  });

  it('locks out after too many wrong attempts, even with the right code afterward', () => {
    const key = `test:${crypto.randomUUID()}`;
    const { code } = createStepUpChallenge(key);

    for (let i = 0; i < 5; i += 1) {
      expect(verifyStepUpChallenge(key, '000000')).toBe(false);
    }

    expect(verifyStepUpChallenge(key, code)).toBe(false);
  });

  it('creating a new challenge for the same key invalidates the old code', () => {
    const key = `test:${crypto.randomUUID()}`;
    const first = createStepUpChallenge(key);
    createStepUpChallenge(key);

    expect(verifyStepUpChallenge(key, first.code)).toBe(false);
  });

  it('clearStepUpChallenge drops a pending challenge without redeeming it', () => {
    const key = `test:${crypto.randomUUID()}`;
    const { code } = createStepUpChallenge(key);

    clearStepUpChallenge(key);

    expect(verifyStepUpChallenge(key, code)).toBe(false);
  });
});
