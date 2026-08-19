'use client';

/* eslint-disable react/jsx-no-bind -- handleConfirm closes over this dialog's own transition state, matching DeactivateFundingBufferButton. */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
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
import { Button } from '@/components/ui/button';
import { deactivateStoreDefaultAction } from '@/app/(portal)/market-rules/pricing-actions';

type DeactivateStoreDefaultButtonProps = {
  policyId: string;
  sellerAccountId: string;
};

export default function DeactivateStoreDefaultButton({
  policyId,
  sellerAccountId,
}: DeactivateStoreDefaultButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deactivateStoreDefaultAction(
        policyId,
        sellerAccountId,
      );

      if (!result.ok) {
        toast.error('Could not deactivate the store default. Try again.');
        return;
      }

      toast.success('Store default deactivated.');
      router.refresh();
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            Deactivate
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate the store default?</AlertDialogTitle>
          <AlertDialogDescription>
            Every category without its own margin — or a priced parent — will
            stop pricing, and the contribution floor disappears with it. Price
            guidance will show &quot;No margin policy&quot; for those products
            until a new default is set.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={handleConfirm}>
            {isPending ? 'Deactivating…' : 'Deactivate'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
