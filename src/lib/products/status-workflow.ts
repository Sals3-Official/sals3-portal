import type { PortalPermission } from '@/lib/auth/permissions';
import type { ProductStatus } from './types';

/**
 * Approval workflow as an allow list.
 *
 * A transition happens only when it appears here. Each entry names the
 * permission the server must check, so a role can never reach a status change
 * it does not hold - for example seller staff can submit a product for review
 * but cannot approve or publish it.
 */

export const STATUS_TRANSITIONS = [
  'submit',
  'approve',
  'reject',
  'publish',
  'unpublish',
  'archive',
  'restore',
] as const;

export type StatusTransition = (typeof STATUS_TRANSITIONS)[number];

type TransitionRule = {
  from: readonly ProductStatus[];
  to: ProductStatus;
  permission: PortalPermission;
  label: string;
  needsReason: boolean;
  destructive: boolean;
};

export const TRANSITION_RULES: Record<StatusTransition, TransitionRule> = {
  submit: {
    from: ['draft', 'rejected'],
    to: 'pending_approval',
    permission: 'product:submit',
    label: 'Send for review',
    needsReason: false,
    destructive: false,
  },
  approve: {
    from: ['pending_approval'],
    to: 'published',
    permission: 'product:approve',
    label: 'Approve and publish',
    needsReason: false,
    destructive: false,
  },
  reject: {
    from: ['pending_approval'],
    to: 'rejected',
    permission: 'product:approve',
    label: 'Reject',
    needsReason: true,
    destructive: false,
  },
  publish: {
    from: ['draft', 'archived'],
    to: 'published',
    permission: 'product:publish',
    label: 'Publish',
    needsReason: false,
    destructive: false,
  },
  unpublish: {
    from: ['published'],
    to: 'draft',
    permission: 'product:publish',
    label: 'Unpublish',
    needsReason: false,
    destructive: false,
  },
  archive: {
    from: ['draft', 'pending_approval', 'published', 'rejected'],
    to: 'archived',
    permission: 'product:archive',
    label: 'Archive',
    needsReason: false,
    destructive: true,
  },
  restore: {
    from: ['archived'],
    to: 'draft',
    permission: 'product:edit',
    label: 'Restore to draft',
    needsReason: false,
    destructive: false,
  },
};

export function isTransitionAllowed(
  transition: StatusTransition,
  from: ProductStatus,
): boolean {
  return TRANSITION_RULES[transition].from.includes(from);
}

/** Transitions available from a status, in the order the UI should show them. */
export function transitionsFrom(from: ProductStatus): StatusTransition[] {
  return STATUS_TRANSITIONS.filter((transition) =>
    isTransitionAllowed(transition, from),
  );
}
