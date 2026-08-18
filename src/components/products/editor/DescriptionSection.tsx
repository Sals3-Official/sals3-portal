import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  descriptionBlocksToPlainText,
  isBlockEmpty,
} from '@/lib/products/description-blocks';
import DescriptionBlockEditor, {
  type KeyedDescriptionBlock,
} from './DescriptionBlockEditor';
import FieldSourceBadge from './FieldSourceBadge';
import MetaDescriptionField from './MetaDescriptionField';

type DescriptionSectionProps = {
  blocks: KeyedDescriptionBlock[];
  onBlocksChange: (blocks: KeyedDescriptionBlock[]) => void;
  /** True while `blocks` still matches what was last loaded from the draft. */
  isUnchanged: boolean;
  onRevert: () => void;
  productName: string;
  metaDescription: string;
  onMetaDescriptionChange: (value: string) => void;
  /** True only while `metaDescription` still holds an unedited suggestion. */
  isMetaDescriptionSuggested: boolean;
  onSaveMetaDescription?: () => Promise<{ ok: boolean; message?: string }>;
};

/**
 * The storefront description, authored as blocks.
 *
 * Blocks rather than one textarea because the storefront's "About this
 * product" section renders four of them — heading, paragraph, bullet list,
 * detail list — and a textarea could only ever produce the third-least
 * useful one. Blocks rather than rich text because there is still no
 * sanitiser: every field here is plain text placed by React, and the
 * document format has no `html` block for a renderer to interpret.
 */
export default function DescriptionSection({
  blocks,
  onBlocksChange,
  isUnchanged,
  onRevert,
  productName,
  metaDescription,
  onMetaDescriptionChange,
  isMetaDescriptionSuggested,
  onSaveMetaDescription,
}: DescriptionSectionProps) {
  const isEmpty = blocks.every((entry) => isBlockEmpty(entry.block));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/*
         * Always the seller's own words. A CJ draft starts from an empty
         * document and supplier description HTML is never copied into a
         * Sals3 product, so a `SUPPLIER` badge here would credit CJ with
         * copy it never wrote.
         */}
        <FieldSourceBadge source="SELLER" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isUnchanged}
          onClick={onRevert}
        >
          <RotateCcw aria-hidden="true" />
          Revert to last saved
        </Button>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-amber-600/30 bg-warning-surface/50 px-3 py-2.5 text-xs text-ink-muted">
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-amber-600"
        />
        The supplier&apos;s own description is raw HTML and is never copied into
        a Sals3 listing — there is no sanitiser to make it safe to publish.
        Write the description here; the storefront renders these blocks as plain
        text, so markup is rejected rather than displayed.
      </p>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Product description</p>
        <DescriptionBlockEditor blocks={blocks} onChange={onBlocksChange} />
        {isEmpty ? (
          <p role="status" className="flex gap-1.5 text-xs text-amber-600">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            Empty description. The listing can publish without one, but the
            storefront will show only specifications.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Recommended order: summary, key features, materials, sizing, package
            contents, care. Blocks publish in the order shown here.
          </p>
        )}
      </div>

      <MetaDescriptionField
        value={metaDescription}
        onChange={onMetaDescriptionChange}
        isSuggested={isMetaDescriptionSuggested}
        productName={productName}
        fallbackDescription={descriptionBlocksToPlainText(
          blocks.map((entry) => entry.block),
        )}
        onSave={onSaveMetaDescription}
      />
    </div>
  );
}
