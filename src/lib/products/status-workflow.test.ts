import { describe, expect, it } from 'vitest';
import { can } from '@/lib/auth/permissions';
import {
  isTransitionAllowed,
  STATUS_TRANSITIONS,
  TRANSITION_RULES,
  transitionsFrom,
} from './status-workflow';

describe('isTransitionAllowed', () => {
  it('lets a draft go for review', () => {
    expect(isTransitionAllowed('submit', 'draft')).toBe(true);
  });

  it('lets a rejected product go for review again', () => {
    expect(isTransitionAllowed('submit', 'rejected')).toBe(true);
  });

  it('refuses to approve a draft that skipped review', () => {
    expect(isTransitionAllowed('approve', 'draft')).toBe(false);
  });

  it('refuses to reject a published product', () => {
    expect(isTransitionAllowed('reject', 'published')).toBe(false);
  });

  it('refuses to archive a product that is already archived', () => {
    expect(isTransitionAllowed('archive', 'archived')).toBe(false);
  });

  it('only restores from archived', () => {
    expect(isTransitionAllowed('restore', 'archived')).toBe(true);
    expect(isTransitionAllowed('restore', 'published')).toBe(false);
  });
});

describe('transitionsFrom', () => {
  it('offers review and archive from draft', () => {
    expect(transitionsFrom('draft')).toEqual(['submit', 'publish', 'archive']);
  });

  it('offers approve and reject while a product waits for review', () => {
    expect(transitionsFrom('pending_approval')).toEqual([
      'approve',
      'reject',
      'archive',
    ]);
  });

  it('offers only unpublish and archive once published', () => {
    expect(transitionsFrom('published')).toEqual(['unpublish', 'archive']);
  });
});

describe('TRANSITION_RULES', () => {
  it('names a permission for every transition', () => {
    STATUS_TRANSITIONS.forEach((transition) => {
      expect(TRANSITION_RULES[transition].permission).toBeTruthy();
    });
  });

  it('keeps approve and reject out of reach for seller roles', () => {
    ['seller_manager', 'seller_staff'].forEach((role) => {
      expect(
        can(
          role as 'seller_manager' | 'seller_staff',
          TRANSITION_RULES.approve.permission,
        ),
      ).toBe(false);
    });
  });

  it('requires a reason only for rejection', () => {
    const needReason = STATUS_TRANSITIONS.filter(
      (transition) => TRANSITION_RULES[transition].needsReason,
    );

    expect(needReason).toEqual(['reject']);
  });
});
