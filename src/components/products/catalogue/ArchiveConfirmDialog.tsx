'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ArchiveConfirmDialogProps = {
  open: boolean;
  count: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/**
 * The one confirmation for archiving on the real catalogue, shared by the row
 * menu and the bulk bar so both state the same consequences.
 *
 * It says what archiving does NOT do, because the fear a seller brings to a
 * destructive-looking button is data loss - and this action genuinely never
 * deletes anything (ADR-007), which is why there is no Delete in this UI at all.
 */
export default function ArchiveConfirmDialog({
  open,
  count,
  onOpenChange,
  onConfirm,
}: ArchiveConfirmDialogProps) {
  const noun = count === 1 ? 'product' : 'products';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Archive {count} {noun}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Archiving stops new sales. It never deletes the product, revision,
            supplier evidence, or audit history, and it never affects an
            already-accepted order.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="px-4 text-xs text-muted-foreground">
          This writes to the database and records an audit event. Published
          products are skipped - taking a live listing down belongs with the
          publish flow, which is not built yet.
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
