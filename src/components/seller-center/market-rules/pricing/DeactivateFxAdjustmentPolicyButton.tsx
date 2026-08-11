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
import { deactivateFxAdjustmentPolicyAction } from '@/app/(portal)/market-rules/pricing-actions';

type DeactivateFxAdjustmentPolicyButtonProps = {
  policyId: string;
  sellerAccountId: string;
  pairLabel: string;
};

export default function DeactivateFxAdjustmentPolicyButton({
  policyId,
  sellerAccountId,
  pairLabel,
}: DeactivateFxAdjustmentPolicyButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deactivateFxAdjustmentPolicyAction(
        policyId,
        sellerAccountId,
      );

      if (!result.ok) {
        toast.error('Could not deactivate this FX adjustment. Try again.');
        return;
      }

      toast.success('FX adjustment deactivated.');
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
          <AlertDialogTitle>Deactivate this FX adjustment?</AlertDialogTitle>
          <AlertDialogDescription>
            Price guidance for {pairLabel} will show &quot;FX adjustment policy
            required&quot; until a new one is created for this pair and funding
            rail.
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
