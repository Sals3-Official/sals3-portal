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
import { deactivateCategoryPolicyAction } from '@/app/(portal)/market-rules/pricing-actions';

type DeactivateCategoryPolicyButtonProps = {
  policyId: string;
  sellerAccountId: string;
  categoryPath: string;
};

export default function DeactivateCategoryPolicyButton({
  policyId,
  sellerAccountId,
  categoryPath,
}: DeactivateCategoryPolicyButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deactivateCategoryPolicyAction(
        policyId,
        sellerAccountId,
      );

      if (!result.ok) {
        toast.error('Could not deactivate this policy. Try again.');
        return;
      }

      toast.success('Category policy deactivated.');
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
          <AlertDialogTitle>Deactivate this category policy?</AlertDialogTitle>
          <AlertDialogDescription>
            Products mapped to {categoryPath} will show &quot;Category policy
            required&quot; and lose price guidance until a new policy is created
            for it.
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
