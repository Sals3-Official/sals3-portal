'use client';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type ConfirmBulkButtonProps = {
  action: 'archive' | 'delete';
  label: string;
  title: string;
  body: string;
  pending: boolean;
  /** Id of the bulk form. The dialog renders in a portal, outside that form. */
  formId: string;
  destructive?: boolean;
};

/**
 * A bulk action that asks first. The title names the exact count, so the person
 * confirming knows how many products the action touches.
 */
export default function ConfirmBulkButton({
  action,
  label,
  title,
  body,
  pending,
  formId,
  destructive = false,
}: ConfirmBulkButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant={destructive ? 'destructive' : 'outline'}
            disabled={pending}
            className="cursor-pointer"
          >
            {label}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer">
            Keep them
          </AlertDialogCancel>
          <AlertDialogAction
            type="submit"
            form={formId}
            name="action"
            value={action}
            className="cursor-pointer"
          >
            Yes, {label.toLowerCase()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
