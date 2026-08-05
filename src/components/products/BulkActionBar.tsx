'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { bulkProductAction } from '@/app/(portal)/products/actions';
import { IDLE_RESULT } from '@/lib/portal/action-result';
import ConfirmBulkButton from './ConfirmBulkButton';

type BulkActionBarProps = {
  selectedIds: string[];
  onClear: () => void;
  canPublish: boolean;
  canArchive: boolean;
  canDelete: boolean;
};

/**
 * The confirmation dialogs render in portals, outside this form's DOM. Their
 * submit buttons are tied back with the `form` attribute, so the chosen action
 * still reaches the server action as the submitter value.
 */
const BULK_FORM_ID = 'bulk-product-form';

/**
 * Sticky bar shown while rows are selected. Destructive entries confirm first
 * and name the exact count, so a mis-click cannot archive or delete in silence.
 */
export default function BulkActionBar({
  selectedIds,
  onClear,
  canPublish,
  canArchive,
  canDelete,
}: BulkActionBarProps) {
  const [result, submit, pending] = useActionState(
    bulkProductAction,
    IDLE_RESULT,
  );
  const count = selectedIds.length;
  const noun = count === 1 ? 'product' : 'products';

  return (
    <form
      id={BULK_FORM_ID}
      action={submit}
      className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm"
    >
      {selectedIds.map((id) => (
        <input key={id} type="hidden" name="productIds" value={id} />
      ))}
      <p className="text-sm font-medium">
        {count} {noun} selected
      </p>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {canPublish ? (
          <>
            <Button
              type="submit"
              name="action"
              value="publish"
              size="sm"
              disabled={pending}
              className="cursor-pointer"
            >
              Publish
            </Button>
            <Button
              type="submit"
              name="action"
              value="unpublish"
              size="sm"
              variant="outline"
              disabled={pending}
              className="cursor-pointer"
            >
              Unpublish
            </Button>
          </>
        ) : null}
        {canArchive ? (
          <ConfirmBulkButton
            action="archive"
            label="Archive"
            title={`Archive ${count} ${noun}?`}
            body="Archived products leave the storefront. You can restore them to draft later."
            pending={pending}
            formId={BULK_FORM_ID}
          />
        ) : null}
        {canDelete ? (
          <ConfirmBulkButton
            action="delete"
            label="Delete"
            title={`Delete ${count} ${noun}?`}
            body="This removes the products from the catalogue. You cannot undo it."
            pending={pending}
            formId={BULK_FORM_ID}
            destructive
          />
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onClear}
          className="cursor-pointer"
        >
          Clear selection
        </Button>
      </div>
      <p
        aria-live="polite"
        className={`w-full text-sm ${
          result.status === 'error'
            ? 'text-destructive'
            : 'text-muted-foreground'
        }`}
      >
        {result.message}
      </p>
    </form>
  );
}
