'use client';

import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ProductRowActionsProps = {
  productId: string;
  productName: string;
  canEdit: boolean;
  canDuplicate: boolean;
  onDuplicate: () => void;
};

/**
 * Per-row menu. The trigger is icon-only, so it carries an accessible name that
 * includes the product name - a screen reader user hears which row it opens.
 */
export default function ProductRowActions({
  productId,
  productName,
  canEdit,
  canDuplicate,
  onDuplicate,
}: ProductRowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-11 cursor-pointer md:size-9"
            aria-label={`Open actions for ${productName}`}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          render={<Link href={`/products/${productId}`}>View details</Link>}
        />
        {canEdit ? (
          <DropdownMenuItem
            render={<Link href={`/products/${productId}/edit`}>Edit</Link>}
          />
        ) : null}
        {canDuplicate ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDuplicate}>Duplicate</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
