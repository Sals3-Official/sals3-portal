'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type RejectDialogProps = {
  pending: boolean;
  errors: string[] | undefined;
  /** Id of the transition form. This dialog renders in a portal outside it. */
  formId: string;
};

/**
 * Rejection needs a written reason: the seller has to know what to fix. The
 * server refuses a rejection with a short or missing reason, so the reason is
 * required, not merely requested.
 */
export default function RejectDialog({
  pending,
  errors,
  formId,
}: RejectDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            className="cursor-pointer"
          >
            Reject
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reject this product?</AlertDialogTitle>
          <AlertDialogDescription>
            Write what the seller must fix. The seller sees this message.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          name="reason"
          form={formId}
          rows={3}
          aria-label="Reason for the rejection"
          placeholder="Example: the photos show another brand name."
          className="bg-card"
        />
        {errors === undefined ? null : (
          <p className="text-xs font-medium text-destructive">{errors[0]}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer">
            Cancel
          </AlertDialogCancel>
          <Button
            type="submit"
            form={formId}
            name="transition"
            value="reject"
            variant="destructive"
            className="cursor-pointer"
          >
            Send rejection
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
