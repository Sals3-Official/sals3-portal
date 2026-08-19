'use client';

import { TriangleAlert, X } from 'lucide-react';
import Image from 'next/image';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
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
 * The mode most sellers want: type the description, done. It writes the same
 * allow-listed block document the designed layout writes — paragraphs split on
 * blank lines — so there is one stored format and one renderer, and switching
 * modes never converts between two schemas.
 *
 * Deliberately just the box. Photos are added in the designed layout, where
 * placement is the whole point; an upload button here could only ever produce
 * "the photos you uploaded, in that order, after the text", which is a worse
 * version of what the other mode does properly. Prompt chips went for the same
 * reason — a row of suggestions around an empty box is furniture, not help.
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
  const images = imagesOf(blocks);

  /**
   * The text being typed is local state, not a value read back out of `blocks`.
   *
   * Deriving it from the document on every render silently made trailing
   * whitespace impossible to type: `descriptionTextToBlocks` trims each
   * paragraph, so a space at the end round-tripped away in the same keystroke
   * that produced it, and the seller watched their space vanish. The trim belongs
   * at save time, where `prepareBlocksForSave` already does it.
   */
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

  function commit(nextText: string, nextImages = images) {
    setText(nextText);
    onBlocksChange(simpleDescriptionToBlocks(nextText, nextImages));
  }

  const missingAlt = images.filter((image) => image.alt.trim() === '').length;

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
          onChange={(event) => commit(event.target.value)}
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

      {/*
       * Photos the document already holds, added in the designed layout.
       *
       * Shown rather than hidden: they are stored content that publishes to the
       * product page, and a screen holding something the seller cannot see is the
       * defect this codebase has met three times. There is no upload here — only
       * the alt text every image needs before publishing, and a way to take one
       * out.
       */}
      {images.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-ink">
            Photos in this description
            <span className="ml-1.5 font-normal text-ink-subtle">
              added in the designed layout, published after the text
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image, index) => (
              <div
                // The address is the identity: two tiles cannot hold one upload,
                // and a stored R2 URL never changes under a tile.
                key={image.url}
                className="flex flex-col gap-1.5"
              >
                <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-surface-sunken">
                  <Image
                    src={image.url}
                    alt={image.alt}
                    fill
                    sizes="(min-width: 1024px) 200px, 45vw"
                    loading="lazy"
                    className="object-cover"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`Remove photo ${index + 1}`}

                    onClick={() =>
                      commit(
                        text,
                        images.filter((_, position) => position !== index),
                      )
                    }
                    className="absolute top-1 right-1 size-6 p-0"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </Button>
                </div>
                <input
                  value={image.alt}
                  aria-label={`Alt text for photo ${index + 1}`}
                  placeholder="Describe this photo"

                  onChange={(event) =>
                    commit(
                      text,
                      images.map((entry, position) =>
                        position === index
                          ? { ...entry, alt: event.target.value }
                          : entry,
                      ),
                    )
                  }
                  className="w-full rounded-md border border-input px-2 py-1 text-xs text-ink placeholder:text-ink-subtle focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-sals3-bright"
                />
              </div>
            ))}
          </div>
          {missingAlt > 0 ? (
            <p role="status" className="flex gap-1.5 text-xs text-amber-700">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0"
              />
              {missingAlt === 1
                ? 'One photo still needs a description. It is required before this listing can publish.'
                : `${missingAlt} photos still need a description. Each is required before this listing can publish.`}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
