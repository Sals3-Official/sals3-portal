'use client';

/* eslint-disable react/no-array-index-key -- List items and detail rows carry
   no identity of their own, and every change rebuilds the whole block, so the
   position *is* the identity. Adding an id would mean storing one in the
   document, which the storefront would then have to ignore. */

import { Plus, TriangleAlert, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { DescriptionImageUpload } from '@/components/products/editor/DescriptionBlockEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DESCRIPTION_BLOCK_LABELS,
  MAX_ALT_LENGTH,
  MAX_LIST_ITEMS,
  describeBlockProblem,
  type DescriptionBlock,
} from '@/lib/products/description-blocks';
import { descriptionImageSpec } from '@/lib/products/description-blocks';
import { IMAGE_UPLOAD_LIMITS_COPY } from '@/lib/products/image-upload-limits';
import DescriptionTableFields from './DescriptionTableFields';

/**
 * Fields for the selected block, for everything the canvas cannot edit in
 * place.
 *
 * Prose is typed on the canvas, at the width it will be read at. A list's items,
 * a detail row's label and value, and an image's file, alt text, and caption are
 * separate fields that need labels and room, so they live here. Alt text
 * specifically is a first-class input rather than an advanced option: it is
 * required by the block, it is the only thing a screen-reader shopper gets, and
 * burying it is how it ends up holding the product title on every image.
 */

const UPLOAD_UNAVAILABLE = 'The image could not be uploaded.';

function uploadButtonLabel(isUploading: boolean, url: string): string {
  if (isUploading) return 'Uploading…';

  return url === '' ? 'Upload image' : 'Replace image';
}

function ItemList({
  items,
  onChange,
  addLabel,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  addLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            value={item}
            aria-label={`Item ${index + 1}`}
            onChange={(event) =>
              onChange(
                items.map((entry, position) =>
                  position === index ? event.target.value : entry,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove item ${index + 1}`}
            disabled={items.length === 1}
            onClick={() => onChange(items.filter((_, p) => p !== index))}
            className="size-8 p-0"
          >
            <X aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={items.length >= MAX_LIST_ITEMS}
        onClick={() => onChange([...items, ''])}
        className="self-start"
      >
        <Plus aria-hidden="true" />
        {addLabel}
      </Button>
    </div>
  );
}

function ImageFields({
  block,
  onChange,
  uploadImage,
  uploadDisabledReason,
  runLength,
}: {
  block: Extract<DescriptionBlock, { type: 'image' }>;
  onChange: (block: DescriptionBlock) => void;
  uploadImage?: DescriptionImageUpload;
  uploadDisabledReason: string | null;
  runLength: number;
}) {
  const spec = descriptionImageSpec(runLength);
  const fileRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (file === undefined || uploadImage === undefined) return;

    setIsUploading(true);
    setError(null);

    try {
      const result = await uploadImage(file);

      if (result.ok) onChange({ ...block, url: result.url });
      else setError(result.message);
    } catch {
      setError(UPLOAD_UNAVAILABLE);
    } finally {
      setIsUploading(false);
      // Clear the input so re-picking the same file fires `change` again.
      if (fileRef.current !== null) fileRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          // Hidden from the accessibility tree: the Upload button is the real
          // control, and a bare file input beside it would be a second,
          // unlabelled way to do the same thing.
          data-testid="description-image-file"
          className="hidden"
          onChange={(event) => {
            // A rejected upload must still clear the uploading state, or the
            // button stays disabled with no explanation.
            pick(event.target.files?.[0]).catch(() =>
              setError(UPLOAD_UNAVAILABLE),
            );
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isUploading || uploadDisabledReason !== null}
          onClick={() => fileRef.current?.click()}
        >
          {uploadButtonLabel(isUploading, block.url)}
        </Button>
        {/* Before the picker opens, not after a refusal: a phone photo is
            routinely wider than 2000 px, and a seller who reads the ceiling
            first resizes once instead of guessing at "that image is too
            large." */}
        {/* The shape, before the picker opens and before any crop happens.
            The storefront renders this slot with `object-cover`, so a photo of
            the wrong ratio is not letterboxed — the difference is cut off, and
            nothing afterwards tells the seller what they lost. */}
        <p className="mt-1.5 text-[11.5px] font-medium text-ink-muted">
          {spec.layout} · {spec.ratio} · best at {spec.width} × {spec.height} px
        </p>
        <p className="mt-1 text-[11.5px] text-ink-subtle">
          {IMAGE_UPLOAD_LIMITS_COPY}
        </p>
        {uploadDisabledReason === null ? null : (
          <p className="mt-1.5 text-[11.5px] text-ink-subtle">
            {uploadDisabledReason}
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="mt-1.5 text-[11.5px] text-red-700">
            {error}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="image-alt" className="mb-1.5 text-[12.5px]">
          Alt text
        </Label>
        <Input
          id="image-alt"
          value={block.alt}
          maxLength={MAX_ALT_LENGTH}
          onChange={(event) => onChange({ ...block, alt: event.target.value })}
        />
        <p className="mt-1 text-[11.5px] text-ink-subtle">
          What the image shows, in your own words. Required — not the product
          title.
        </p>
      </div>

      <div>
        <Label htmlFor="image-caption" className="mb-1.5 text-[12.5px]">
          Caption <span className="font-normal text-ink-subtle">optional</span>
        </Label>
        <Input
          id="image-caption"
          value={block.caption ?? ''}
          onChange={(event) =>
            onChange({
              ...block,
              caption:
                event.target.value === '' ? undefined : event.target.value,
            })
          }
        />
        <p className="mt-1 text-[11.5px] text-ink-subtle">
          Printed under the image on the product page.
        </p>
      </div>
    </div>
  );
}

type BlockInspectorProps = {
  block: DescriptionBlock | null;
  onChange: (block: DescriptionBlock) => void;
  uploadImage?: DescriptionImageUpload;
  uploadDisabledReason: string | null;
  /**
   * Images in the selected block's consecutive run, which is what decides its
   * ratio. 1 for a text block or a lone image.
   */
  runLength: number;
};

export default function BlockInspector({
  block,
  onChange,
  uploadImage,
  uploadDisabledReason,
  runLength,
}: BlockInspectorProps) {
  if (block === null) {
    return (
      <div>
        <p className="mb-2 text-[10.5px] font-bold tracking-[0.09em] text-ink-subtle uppercase">
          Selected block
        </p>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Select a block on the canvas to edit its fields. Paragraphs and
          headings are typed directly on the canvas.
        </p>
      </div>
    );
  }

  const problem = describeBlockProblem(block);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1 text-[10.5px] font-bold tracking-[0.09em] text-ink-subtle uppercase">
          Selected block
        </p>
        <p className="font-display m-0 text-[15px] font-semibold text-ink">
          {DESCRIPTION_BLOCK_LABELS[block.type]}
        </p>
      </div>

      {problem === null ? null : (
        <p
          role="status"
          className="flex gap-1.5 rounded-lg border border-warning-border bg-warning-surface px-2.5 py-2 text-[12px] leading-[1.55] text-amber-700"
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          {problem}
        </p>
      )}

      {block.type === 'heading' ? (
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-1.5 text-[12.5px] font-semibold text-ink">
            Role on the page
          </legend>
          <div className="flex gap-1.5">
            {([2, 3] as const).map((level) => (
              <Button
                key={level}
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={block.level === level}
                onClick={() => onChange({ ...block, level })}
                className={
                  block.level === level
                    ? 'border-sals3-bright bg-sals3-deep/8 text-sals3-deep'
                    : ''
                }
              >
                {level === 2 ? 'Section heading' : 'Sub-heading'}
              </Button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-subtle">
            The product title owns the page&apos;s only top-level heading, so
            these sit beneath it.
          </p>
        </fieldset>
      ) : null}

      {block.type === 'bulletList' ? (
        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold text-ink">Items</p>
          <ItemList
            items={block.items}
            addLabel="Add item"
            onChange={(items) => onChange({ ...block, items })}
          />
        </div>
      ) : null}

      {block.type === 'keyValueList' ? (
        <div className="flex flex-col gap-2">
          <p className="mb-0 text-[12.5px] font-semibold text-ink">Rows</p>
          {block.entries.map((entry, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <Input
                value={entry.label}
                aria-label={`Row ${index + 1} label`}
                placeholder="Label"
                onChange={(event) =>
                  onChange({
                    ...block,
                    entries: block.entries.map((row, position) =>
                      position === index
                        ? { ...row, label: event.target.value }
                        : row,
                    ),
                  })
                }
              />
              <Input
                value={entry.value}
                aria-label={`Row ${index + 1} value`}
                placeholder="Value"
                onChange={(event) =>
                  onChange({
                    ...block,
                    entries: block.entries.map((row, position) =>
                      position === index
                        ? { ...row, value: event.target.value }
                        : row,
                    ),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove row ${index + 1}`}
                disabled={block.entries.length === 1}
                onClick={() =>
                  onChange({
                    ...block,
                    entries: block.entries.filter((_, p) => p !== index),
                  })
                }
                className="size-8 shrink-0 p-0"
              >
                <X aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={block.entries.length >= MAX_LIST_ITEMS}
            onClick={() =>
              onChange({
                ...block,
                entries: [...block.entries, { label: '', value: '' }],
              })
            }
            className="self-start"
          >
            <Plus aria-hidden="true" />
            Add row
          </Button>
        </div>
      ) : null}

      {block.type === 'table' ? (
        <div className="flex flex-col gap-4">
          <DescriptionTableFields block={block} onChange={onChange} />

          <div>
            <Label htmlFor="table-caption" className="mb-1.5 text-[12.5px]">
              Caption{' '}
              <span className="font-normal text-ink-subtle">optional</span>
            </Label>
            <Input
              id="table-caption"
              value={block.caption ?? ''}
              placeholder="Measurements in cm, taken flat"
              onChange={(event) =>
                onChange({
                  ...block,
                  caption:
                    event.target.value === '' ? undefined : event.target.value,
                })
              }
            />
            {/*
              Not decoration. On the product page this becomes the table's
              `<caption>`, which is the only name a screen-reader shopper is
              given for the grid they have just landed in — a heading block
              above it is a sibling element, not a label. It is also where the
              unit belongs: a size chart of bare numbers does not say whether
              they are centimetres.
            */}
            <p className="mt-1 text-[11.5px] text-ink-subtle">
              Printed above the table and read out to shoppers using a screen
              reader. Name the units here.
            </p>
          </div>
        </div>
      ) : null}

      {block.type === 'image' ? (
        <ImageFields
          block={block}
          onChange={onChange}
          uploadImage={uploadImage}
          uploadDisabledReason={uploadDisabledReason}
          runLength={runLength}
        />
      ) : null}
    </div>
  );
}
