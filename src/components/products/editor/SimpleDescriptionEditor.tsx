'use client';

import { ImageOff, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { DescriptionBlock } from '@/lib/products/description-blocks';
import {
  SIMPLE_TEXT_SOFT_MAX,
  blocksToSimpleText,
  imagesOf,
  normalizeSimpleText,
  simpleDescriptionToBlocks,
} from '@/lib/products/simple-description';
import { cn } from '@/lib/utils';

/**
 * The description as one box of text.
 *
 * What this box holds is exactly what the product page shows: its paragraphs.
 * Headings, lists, and photo placement belong to the designed layout.
 *
 * A photo saved in the designed layout is **kept, not deleted** — it rides along
 * in the stored document, is not published while simple text is on, and comes
 * back whole on switching layout again. The seller is told it is there, because a
 * photo that is neither visible nor mentioned reads as one that was thrown away.
 *
 * It writes the same allow-listed block document the designed layout writes —
 * paragraphs split on blank lines — so there is one stored format and one
 * renderer, and switching modes never converts between two schemas.
 *
 * Still no markup. This is a `<textarea>`: what a seller types is text, pasted
 * formatting arrives as the words without the tags, and `MARKUP_OPENER` refuses
 * anything tag-shaped at the server boundary rather than escaping it.
 */

type SimpleDescriptionEditorProps = {
  blocks: DescriptionBlock[];
  onBlocksChange: (blocks: DescriptionBlock[]) => void;
};

export default function SimpleDescriptionEditor({
  blocks,
  onBlocksChange,
}: SimpleDescriptionEditorProps) {
  const fieldId = useId();

  /**
   * The text being typed is local state, not a value read back out of `blocks`.
   *
   * Deriving it from the document on every render silently made trailing
   * whitespace impossible to type: `descriptionTextToBlocks` trims each
   * paragraph, so a space at the end round-tripped away in the same keystroke
   * that produced it, and the seller watched their space vanish. The trim belongs
   * at save time, where `prepareBlocksForSave` already does it.
   */
  const retainedImages = imagesOf(blocks);
  const derivedText = blocksToSimpleText(blocks);
  const [text, setText] = useState(derivedText);

  /*
   * React's "adjusting state when a prop changes" pattern, not an effect — the
   * same shape the category-attribute resync uses.
   *
   * The comparison is against this field's *own projection*, never against its
   * raw value. Text ending in a space projects to the same text without it, so
   * comparing raw values would read the parent's faithful echo as a foreign
   * change and resync the space away. A mismatch here means the document really
   * was replaced somewhere else: a revert, or a flatten out of designed mode.
   */
  if (derivedText !== normalizeSimpleText(text)) setText(derivedText);

  const isOverSoftMax = text.length > SIMPLE_TEXT_SOFT_MAX;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-input">
        <Label htmlFor={fieldId} className="sr-only">
          Product description
        </Label>
        <Textarea
          id={fieldId}
          value={text}
          rows={14}
          onChange={(event) => {
            setText(event.target.value);
            // The retained photos are re-attached on every edit, so typing here
            // can never be the thing that drops one.
            onBlocksChange(
              simpleDescriptionToBlocks(event.target.value, retainedImages),
            );
          }}
          placeholder={
            'Describe the product in your own words.\n\nLeave a blank line to start a new paragraph.'
          }
          className="min-h-[280px] resize-y rounded-none border-0 px-3 py-3 text-[15px] leading-[1.7] shadow-none focus-visible:ring-0"
        />
        <div className="flex justify-end border-t border-border bg-background px-3 py-1.5">
          <span
            className={cn(
              'text-xs',
              isOverSoftMax ? 'font-medium text-amber-700' : 'text-ink-subtle',
            )}
          >
            {text.length.toLocaleString()}/
            {SIMPLE_TEXT_SOFT_MAX.toLocaleString()}
          </span>
        </div>
      </div>

      {retainedImages.length === 0 ? null : (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-ink-muted">
          <ImageOff
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0 text-ink-subtle"
          />
          {retainedImages.length === 1
            ? 'One photo from the designed layout is saved with this description. Simple text does not show it on the product page — switch to the designed layout to place it again.'
            : `${retainedImages.length} photos from the designed layout are saved with this description. Simple text does not show them on the product page — switch to the designed layout to place them again.`}
        </p>
      )}

      {isOverSoftMax ? (
        <p role="status" className="flex gap-1.5 text-xs text-amber-700">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          Longer than the {SIMPLE_TEXT_SOFT_MAX.toLocaleString()}-character
          guide. Nothing is cut and the listing still saves — buyers just rarely
          read past this length.
        </p>
      ) : null}
    </div>
  );
}
