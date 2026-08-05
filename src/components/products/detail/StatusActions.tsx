'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { transitionProductAction } from '@/app/(portal)/products/actions';
import { IDLE_RESULT } from '@/lib/portal/action-result';
import {
  TRANSITION_RULES,
  type StatusTransition,
} from '@/lib/products/status-workflow';
import RejectDialog from './RejectDialog';

type StatusActionsProps = {
  productId: string;
  transitions: StatusTransition[];
};

const FORM_ID = 'status-transition-form';

/**
 * Approval workflow buttons. Only transitions the current status allows are
 * rendered, and the server checks the role and the transition again before
 * anything changes.
 */
export default function StatusActions({
  productId,
  transitions,
}: StatusActionsProps) {
  const [result, submit, pending] = useActionState(
    transitionProductAction,
    IDLE_RESULT,
  );

  if (transitions.length === 0) {
    return null;
  }

  return (
    <form id={FORM_ID} action={submit} className="flex flex-col gap-2">
      <input type="hidden" name="productId" value={productId} />
      <div className="flex flex-wrap items-center gap-2">
        {transitions.map((transition) =>
          transition === 'reject' ? (
            <RejectDialog
              key={transition}
              pending={pending}
              errors={result.fieldErrors.reason}
              formId={FORM_ID}
            />
          ) : (
            <Button
              key={transition}
              type="submit"
              name="transition"
              value={transition}
              size="sm"
              variant={
                TRANSITION_RULES[transition].destructive ? 'outline' : 'default'
              }
              disabled={pending}
              className="cursor-pointer"
            >
              {TRANSITION_RULES[transition].label}
            </Button>
          ),
        )}
      </div>
      <p
        aria-live="polite"
        className={`text-sm ${
          result.status === 'error'
            ? 'font-medium text-destructive'
            : 'text-muted-foreground'
        }`}
      >
        {result.message}
      </p>
    </form>
  );
}
