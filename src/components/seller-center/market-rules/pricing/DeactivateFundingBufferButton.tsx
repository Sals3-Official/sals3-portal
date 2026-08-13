'use client';

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
import { deactivateFundingBufferPolicyAction } from '@/app/(portal)/market-rules/pricing-actions';

type DeactivateFundingBufferButtonProps = {
  policyId: string;
  sellerAccountId: string;
};

export default function DeactivateFundingBufferButton({
  policyId,
  sellerAccountId,
}: DeactivateFundingBufferButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deactivateFundingBufferPolicyAction(
        policyId,
        sellerAccountId,
      );

      if (!result.ok) {
        toast.error('Could not deactivate the funding buffer. Try again.');
        return;
      }

      toast.success('Funding buffer deactivated.');
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
          <AlertDialogTitle>Deactivate this funding buffer?</AlertDialogTitle>
          <AlertDialogDescription>
            Price guidance will show &quot;Funding buffer required&quot; until a
            new buffer is set.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={() => handleConfirm()}
          >
            {isPending ? 'Deactivating…' : 'Deactivate'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
