'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { createProductDraftAction } from '@/app/(portal)/listings/product-draft-actions';
import { Button } from '@/components/ui/button';

type CustomizeAndListButtonProps = {
  candidateId: string;
  productName: string;
  disabled?: boolean;
};

const FAILURE_MESSAGES: Record<string, string> = {
  invalid_input: 'That candidate id was not in an expected format.',
  denied: 'Your role cannot customize this supplier product.',
  rate_limited: 'Too many supplier evidence fetches. Wait a moment.',
  not_configured: 'No database is configured in this environment.',
  not_found: 'That candidate is no longer in your pipeline.',
  connection_unhealthy: 'Your CJ connection needs attention first.',
  supplier_unavailable: 'CJ did not answer. Nothing was saved.',
  idempotency_conflict: 'This request key was already used differently.',
  failed: 'Could not create the product draft. Try again in a moment.',
};

function idempotencyKey(candidateId: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2, 12);

  return `catalog-draft:${candidateId}:${random}`;
}

export default function CustomizeAndListButton({
  candidateId,
  productName,
  disabled = false,
}: CustomizeAndListButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await createProductDraftAction({
            candidateId,
            idempotencyKey: idempotencyKey(candidateId),
          });

          if (!result.ok) {
            toast(FAILURE_MESSAGES[result.reason]);
            return;
          }

          toast(`Product draft ready for "${productName}".`);
          router.push(`/listings/new?productId=${result.result.productId}`);
        });
      }}
    >
      {isPending ? 'Fetching from CJ...' : 'Add & Customize'}
    </Button>
  );
}
