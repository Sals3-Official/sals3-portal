'use client';

import { ImagePlus, Plus, TriangleAlert, X } from 'lucide-react';
import Image from 'next/image';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { DescriptionBlock } from '@/lib/products/description-blocks';
import {
  SIMPLE_MAX_IMAGES,
  SIMPLE_TEXT_SOFT_MAX,
  blocksToSimpleText,
  imagesOf,
  normalizeSimpleText,
  simpleDescriptionToBlocks,
} from '@/lib/products/simple-description';
import { cn } from '@/lib/utils';
import type { DescriptionImageUpload } from './DescriptionBlockEditor';

/**
 * The description as one box of text, plus photos after it.
 *
 * The mode most sellers want: type the description, attach a few photos, done.
 * It writes the same allow-listed block document design mode writes — paragraphs
 * split on blank lines, images appended — so there is one stored format and one
 * renderer, and switching modes never converts between two schemas.
 *
 * Still no markup. This is a `<textarea>`: what a seller types is text, pasted
 * formatting arrives as the words without the tags, and `MARKUP_OPENER` refuses
 * anything tag-shaped at the server boundary rather than escaping it.
 */

const UPLOAD_UNAVAILABLE = 'The image could not be uploaded.';

/**
 * Prompts for facts buyers ask for, drawn from the product's own category.
 *
 * `suggestedAxisNamesForCategory` reads the owner-authored workbook's attribute
 * families, so a jacket offers Colour and Size while a kettle offers Capacity —
 * the same source the Variant Matrix suggests option names from. The universal
 * two are appended because every physical product has care and usage facts no
 * category table needs to name.
 *
 * A chip inserts a labelled line and nothing else. It never writes the value,
 * for the same reason the Variant Matrix offers an axis name behind a button
 * instead of pre-filling it: the workbook knows what a category is usually
 * described by, and cannot know this product's answer.
 */
function chipLabels(categoryAxisNames: readonly (string | null)[]): string[] {
  const fromCategory = categoryAxisNames.filter(
    (name): name is string => name !== null,
  );

  return [...new Set([...fromCategory, 'Instructions for use', 'Care'])];
}

type SimpleDescriptionEditorProps = {
  blocks: DescriptionBlock[];
  onBlocksChange: (blocks: DescriptionBlock[]) => void;
  /** Tier-1/tier-2 axis names for this product's Sals3 category, positionally aligned. */
  categoryAxisNames: readonly (string | null)[];
  uploadImage?: DescriptionImageUpload;
  uploadDisabledReason?: string | null;
};

export default function SimpleDescriptionEditor({
  blocks,
  onBlocksChange,
  categoryAxisNames,
  uploadImage,
  uploadDisabledReason = null,
}: SimpleDescriptionEditorProps) {
  const fieldId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const images = imagesOf(blocks);

  /**
   * The text being typed is local state, not a value read back out of `blocks`.
   *
   * Deriving it from the document on every render silently made trailing
   * whitespace impossible to type: `descriptionTextToBlocks` trims each
   * paragraph, so a space at the end of the field round-tripped away in the same
   * keystroke that produced it, and the seller watched their space vanish. The
   * trim belongs at save time, where `prepareBlocksForSave` already does it.
   *
   * `blocks` is still the source of truth. It just cannot be the *input*, so the
   * two are reconciled below only when the document genuinely changed.
   */
  const derivedText = blocksToSimpleText(blocks);
  const [text, setText] = useState(derivedText);

  /*
   * React's "adjusting state when a prop changes" pattern, not an effect — the
   * same shape the category-attribute resync uses.
   *
   * The comparison is against this field's *own projection*, never against its
   * raw value. `Care: ` with the caret after the space projects to `Care:`, so
   * comparing raw values would read the parent's faithful echo as a foreign
   * change and resync the space away — which is exactly the bug this replaced.
   * A mismatch here means the document really was replaced somewhere else: a
   * revert, or a flatten out of designed mode.
   */
  if (derivedText !== normalizeSimpleText(text)) setText(derivedText);

  const isOverSoftMax = text.length > SIMPLE_TEXT_SOFT_MAX;

  function commit(nextText: string, nextImages = images) {
    setText(nextText);
    onBlocksChange(simpleDescriptionToBlocks(nextText, nextImages));
  }

  /** Appends a labelled line and puts the caret after it, ready to type the value. */
  function insertPrompt(label: string) {
    const separator = text.trim() === '' ? '' : '\n\n';
    const next = `${text}${separator}${label}: `;

    commit(next);
    requestAnimationFrame(() => {
      const field = textareaRef.current;

      if (field === null) return;

      field.focus();
      field.setSelectionRange(next.length, next.length);
    });
  }

  async function upload(file: File | undefined) {
    if (file === undefined || uploadImage === undefined) return;

    setIsUploading(true);
    setError(null);

    try {
      const result = await uploadImage(file);

      if (result.ok) {
        commit(text, [
          ...images,
          // Alt text is required by the block and is the only thing a
          // screen-reader shopper gets, so it is asked for on the tile rather
          // than defaulted to the product title the way the gallery does.
          { type: 'image', url: result.url, alt: '' },
        ]);
      } else setError(result.message);
    } catch {
      setError(UPLOAD_UNAVAILABLE);
    } finally {
      setIsUploading(false);
      if (fileRef.current !== null) fileRef.current.value = '';
    }
  }

  const missingAlt = images.filter((image) => image.alt.trim() === '').length;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-input">
        <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            data-testid="simple-description-file"
            className="hidden"
            onChange={(event) => {
              upload(event.target.files?.[0]).catch(() =>
                setError(UPLOAD_UNAVAILABLE),
              );
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-sals3-deep"
            disabled={
              isUploading ||
              uploadImage === undefined ||
              images.length >= SIMPLE_MAX_IMAGES
            }
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus aria-hidden="true" />
            {isUploading
              ? 'Uploading…'
              : `Add images (${images.length}/${SIMPLE_MAX_IMAGES})`}
          </Button>

          <span
            className={cn(
              'ml-auto text-xs',
              isOverSoftMax ? 'font-medium text-amber-700' : 'text-ink-subtle',
            )}
          >
            {text.length.toLocaleString()}/
            {SIMPLE_TEXT_SOFT_MAX.toLocaleString()}
          </span>
        </div>

        <Label htmlFor={fieldId} className="sr-only">
          Product description
        </Label>
        <Textarea
          id={fieldId}
          ref={textareaRef}
          value={text}
          rows={14}
          onChange={(event) => commit(event.target.value)}
          placeholder={
            'Describe the product in your own words.\n\nLeave a blank line to start a new paragraph.'
          }
          className="min-h-[280px] resize-y rounded-none border-0 px-3 py-3 text-[15px] leading-[1.7] shadow-none focus-visible:ring-0"
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          <span className="text-xs text-ink-subtle">Recommended input</span>
          {chipLabels(categoryAxisNames).map((label) => (
            <Button
              key={label}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-full px-2.5 text-xs text-sals3-deep"
              onClick={() => insertPrompt(label)}
            >
              <Plus aria-hidden="true" className="size-3" />
              {label}
            </Button>
          ))}
        </div>
      </div>

      {uploadDisabledReason === null ? null : (
        <p className="text-xs text-ink-subtle">{uploadDisabledReason}</p>
      )}

      {error === null ? null : (
        <p role="alert" className="text-xs text-red-700">
          {error}
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

      {images.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-ink">
            Photos, shown after the text
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
