'use client';

import { useId, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Images,
  Plus,
  TriangleAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  DESCRIPTION_BLOCK_LABELS,
  MAX_ALT_LENGTH,
  MAX_BLOCKS,
  MAX_LIST_ITEMS,
  MAX_TEXT_LENGTH,
  describeBlockProblem,
  emptyBlockOfType,
  imageRunAt,
  type DescriptionBlock,
  type DescriptionBlockType,
  type ImageBlock,
} from '@/lib/products/description-blocks';

/**
 * The block editor behind the storefront's "About this product" section.
 *
 * The four block types here are exactly the four the description document
 * allows and the storefront already renders — heading, paragraph, bullet
 * list, and detail list. Until this screen existed, the seller had one
 * textarea and the save path turned it into paragraphs, so three of the four
 * were unreachable from the portal even though every layer beneath could
 * carry them.
 *
 * Still not a rich-text editor, and the reason is unchanged: there is no
 * sanitiser. Each block is a typed field whose text is placed by React, so
 * nothing a seller types can arrive at the storefront as markup. A
 * formatting toolbar would imply otherwise.
 */

export type KeyedDescriptionBlock = {
  /**
   * React list identity only — never a DOM id.
   *
   * Blocks carry no id of their own and this list reorders, so an index key
   * would move a seller's cursor to a different field mid-edit. The counter
   * behind it is per module instance, which differs between the server and
   * the browser, so putting it in an `id` attribute produced a hydration
   * mismatch. Field ids come from `useId` instead.
   */
  key: string;
  block: DescriptionBlock;
};

let nextBlockKey = 0;

export function keyDescriptionBlocks(
  blocks: readonly DescriptionBlock[],
): KeyedDescriptionBlock[] {
  return blocks.map((block) => {
    nextBlockKey += 1;

    return { key: `block-${nextBlockKey}`, block };
  });
}

/**
 * What the seller can add, named after what the storefront produces.
 *
 * The image entries are layout presets, not new block types: the storefront
 * derives image layout from adjacency — one image alone runs full width at
 * 16:9, two or more pair into a grid at 4:3 — so "Two images side by side"
 * is simply two consecutive image blocks. Storing a group would mean a
 * container that can be left half-empty by a delete; deriving it cannot.
 *
 * Only layouts the storefront actually renders appear here. A preset the
 * page cannot produce would make this editor a preview that lies.
 */
function PresetIcon({ preset }: { preset: BlockPreset }) {
  if (preset.type !== 'image') return <Plus aria-hidden="true" />;

  return preset.count === 1 ? (
    <ImageIcon aria-hidden="true" />
  ) : (
    <Images aria-hidden="true" />
  );
}

type BlockPreset = {
  id: string;
  label: string;
  type: DescriptionBlockType;
  count: number;
  hint?: string;
};

const BLOCK_PRESETS: BlockPreset[] = [
  {
    id: 'paragraph',
    label: DESCRIPTION_BLOCK_LABELS.paragraph,
    type: 'paragraph',
    count: 1,
  },
  {
    id: 'heading',
    label: DESCRIPTION_BLOCK_LABELS.heading,
    type: 'heading',
    count: 1,
  },
  {
    id: 'bulletList',
    label: DESCRIPTION_BLOCK_LABELS.bulletList,
    type: 'bulletList',
    count: 1,
  },
  {
    id: 'keyValueList',
    label: DESCRIPTION_BLOCK_LABELS.keyValueList,
    type: 'keyValueList',
    count: 1,
  },
  { id: 'image', label: 'Image', type: 'image', count: 1, hint: 'Full width' },
  {
    id: 'image-pair',
    label: 'Two images',
    type: 'image',
    count: 2,
    hint: 'Side by side',
  },
  {
    id: 'image-trio',
    label: 'Three images',
    type: 'image',
    count: 3,
    hint: 'Row of three',
  },
];

/** A heading's role on the page, not its tag depth. */
const HEADING_LEVEL_LABELS: Record<2 | 3, string> = {
  2: 'Section heading',
  3: 'Sub-heading',
};

function HeadingLevelSelect({
  id,
  level,
  onChange,
}: {
  id: string;
  level: 2 | 3;
  onChange: (level: 2 | 3) => void;
}) {
  return (
    <Select
      value={String(level)}
      onValueChange={(value) => onChange(value === '2' ? 2 : 3)}
    >
      <SelectTrigger id={id} size="sm" aria-label="Heading level">
        {/*
         * Named explicitly rather than left to `SelectValue` to look up: the
         * stored value is the HTML level, so the trigger otherwise reads
         * "3" at the seller.
         */}
        <SelectValue>{HEADING_LEVEL_LABELS[level]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="2">{HEADING_LEVEL_LABELS[2]}</SelectItem>
        <SelectItem value="3">{HEADING_LEVEL_LABELS[3]}</SelectItem>
      </SelectContent>
    </Select>
  );
}

type ItemRow = {
  id: string;
  /**
   * `name` rather than a positional key: a row's fields are fixed by block
   * type (one for a bullet, label/value for a detail), so naming them keeps
   * the input identity stable and readable.
   */
  fields: {
    name: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
  }[];
  /** Names the row itself, not its first field. */
  removeLabel: string;
  onRemove: () => void;
};

function ItemRows({
  rows,
  addLabel,
  canAdd,
  onAdd,
}: {
  rows: ItemRow[];
  addLabel: string;
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2">
          {row.fields.map((field) => (
            <div key={`${row.id}-${field.name}`} className="flex-1">
              <Label htmlFor={`${row.id}-${field.name}`} className="sr-only">
                {field.label}
              </Label>
              <Input
                id={`${row.id}-${field.name}`}
                value={field.value}
                placeholder={field.label}
                onChange={(event) => field.onChange(event.target.value)}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${row.removeLabel.toLowerCase()}`}
            onClick={row.onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={!canAdd}
        onClick={onAdd}
      >
        <Plus aria-hidden="true" />
        {addLabel}
      </Button>
    </div>
  );
}

export type DescriptionImageUpload = (
  file: File,
) => Promise<{ ok: true; url: string } | { ok: false; message: string }>;

/**
 * One description image: the file, the alt text, and an optional caption.
 *
 * The alt field is a first-class input rather than an advanced option. It is
 * required by the block, it is the only thing a screen-reader shopper gets,
 * and burying it is how it ends up holding the product title on every image.
 */
const UPLOAD_UNAVAILABLE = 'The image could not be uploaded.';

function uploadButtonLabel(isUploading: boolean, url: string): string {
  if (isUploading) return 'Uploading…';

  return url === '' ? 'Upload image' : 'Replace image';
}

function ImageBlockFields({
  fieldKey,
  block,
  onChange,
  upload,
  uploadDisabledReason,
}: {
  fieldKey: string;
  block: ImageBlock;
  onChange: (block: DescriptionBlock) => void;
  upload?: DescriptionImageUpload;
  uploadDisabledReason: string | null;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadDisabled = upload === undefined || uploadDisabledReason !== null;

  const onFile = async (file: File | undefined) => {
    if (file === undefined || upload === undefined) return;

    setFailure(null);
    setIsUploading(true);

    const result = await upload(file);

    setIsUploading(false);

    if (!result.ok) {
      setFailure(result.message);

      return;
    }

    onChange({ ...block, url: result.url });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2 @min-[32rem]:flex-row">
        <div className="flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted @min-[32rem]:w-48">
          {block.url === '' ? (
            <ImageIcon
              aria-hidden="true"
              className="size-6 text-muted-foreground"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={block.url}
              alt={
                block.alt === ''
                  ? 'Uploaded image, not yet described'
                  : block.alt
              }
              className="size-full object-cover"
            />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/*
           * Hidden from the accessibility tree on purpose: the Upload
           * button beside it is the control. Leaving the input focusable
           * would put an unlabelled second stop in the tab order for the
           * same action.
           */}
          <input
            ref={inputRef}
            data-testid={`${fieldKey}-file`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const picked = event.target.files?.[0];

              // Reset through the ref, not the event's own target: picking
              // the same file twice fires no `change` unless the input is
              // cleared, and `files` must be read before it is.
              if (inputRef.current !== null) inputRef.current.value = '';

              onFile(picked).catch(() => setFailure(UPLOAD_UNAVAILABLE));
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadDisabled || isUploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              {uploadButtonLabel(isUploading, block.url)}
            </Button>
            <span className="text-xs text-muted-foreground">
              JPEG, PNG, or WebP · up to 5 MB · 2000 × 2000 px
            </span>
          </div>

          {uploadDisabledReason === null ? null : (
            <p className="text-xs text-ink-muted">{uploadDisabledReason}</p>
          )}

          {failure === null ? null : (
            <p role="status" className="flex gap-1.5 text-xs text-destructive">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0"
              />
              {failure}
            </p>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldKey}-alt`} className="text-xs">
              Alt text
            </Label>
            <Input
              id={`${fieldKey}-alt`}
              value={block.alt}
              maxLength={MAX_ALT_LENGTH}
              placeholder="What the image shows, for shoppers using a screen reader"
              onChange={(event) =>
                onChange({ ...block, alt: event.target.value })
              }
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldKey}-caption`} className="text-xs">
              Caption <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id={`${fieldKey}-caption`}
              value={block.caption ?? ''}
              placeholder="Printed under the image on the storefront"
              onChange={(event) =>
                onChange({ ...block, caption: event.target.value })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function BlockFields({
  fieldKey,
  block,
  onChange,
  upload,
  uploadDisabledReason,
}: {
  fieldKey: string;
  block: DescriptionBlock;
  onChange: (block: DescriptionBlock) => void;
  upload?: DescriptionImageUpload;
  uploadDisabledReason: string | null;
}) {
  if (block.type === 'paragraph') {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${fieldKey}-text`} className="sr-only">
          Paragraph text
        </Label>
        <Textarea
          id={`${fieldKey}-text`}
          rows={4}
          maxLength={MAX_TEXT_LENGTH}
          placeholder="What a buyer needs to know about this product."
          value={block.text}
          onChange={(event) => onChange({ ...block, text: event.target.value })}
        />
        <p className="text-right text-xs text-muted-foreground tabular-nums">
          {block.text.length} / {MAX_TEXT_LENGTH}
        </p>
      </div>
    );
  }

  if (block.type === 'heading') {
    return (
      <>
        <Label htmlFor={`${fieldKey}-text`} className="sr-only">
          Heading text
        </Label>
        <Input
          id={`${fieldKey}-text`}
          placeholder="Fit and sizing, Materials, In the box…"
          value={block.text}
          onChange={(event) => onChange({ ...block, text: event.target.value })}
        />
      </>
    );
  }

  if (block.type === 'image') {
    return (
      <ImageBlockFields
        fieldKey={fieldKey}
        block={block}
        onChange={onChange}
        upload={upload}
        uploadDisabledReason={uploadDisabledReason}
      />
    );
  }

  if (block.type === 'bulletList') {
    return (
      <ItemRows
        rows={block.items.map((item, index) => ({
          id: `${fieldKey}-item-${index}`,
          removeLabel: `Bullet ${index + 1}`,
          fields: [
            {
              name: 'item',
              label: `Bullet ${index + 1}`,
              value: item,
              onChange: (value: string) =>
                onChange({
                  ...block,
                  items: block.items.map((existing, position) =>
                    position === index ? value : existing,
                  ),
                }),
            },
          ],
          onRemove: () =>
            onChange({
              ...block,
              items: block.items.filter((_, position) => position !== index),
            }),
        }))}
        addLabel="Add bullet"
        canAdd={block.items.length < MAX_LIST_ITEMS}
        onAdd={() => onChange({ ...block, items: [...block.items, ''] })}
      />
    );
  }

  return (
    <ItemRows
      rows={block.entries.map((entry, index) => ({
        id: `${fieldKey}-entry-${index}`,
        removeLabel: `Detail ${index + 1}`,
        fields: [
          {
            name: 'label',
            label: `Detail ${index + 1} label`,
            value: entry.label,
            onChange: (value: string) =>
              onChange({
                ...block,
                entries: block.entries.map((existing, position) =>
                  position === index ? { ...existing, label: value } : existing,
                ),
              }),
          },
          {
            name: 'value',
            label: `Detail ${index + 1} value`,
            value: entry.value,
            onChange: (value: string) =>
              onChange({
                ...block,
                entries: block.entries.map((existing, position) =>
                  position === index ? { ...existing, value } : existing,
                ),
              }),
          },
        ],
        onRemove: () =>
          onChange({
            ...block,
            entries: block.entries.filter((_, position) => position !== index),
          }),
      }))}
      addLabel="Add detail"
      canAdd={block.entries.length < MAX_LIST_ITEMS}
      onAdd={() =>
        onChange({
          ...block,
          entries: [...block.entries, { label: '', value: '' }],
        })
      }
    />
  );
}

type DescriptionBlockEditorProps = {
  blocks: KeyedDescriptionBlock[];
  onChange: (blocks: KeyedDescriptionBlock[]) => void;
  /** Omitted in design-preview mode, where no real product can hold a file. */
  uploadImage?: DescriptionImageUpload;
  /**
   * Why uploading is unavailable, in the seller's terms. Shown beside a
   * disabled Upload button rather than hiding the control — a missing button
   * reads as a missing feature, an explained one reads as a setup step.
   */
  uploadDisabledReason?: string | null;
};

export default function DescriptionBlockEditor({
  blocks,
  onChange,
  uploadImage,
  uploadDisabledReason = null,
}: DescriptionBlockEditorProps) {
  // Server and client agree on this; the block keys above do not.
  const fieldIdPrefix = useId();

  const replaceAt = (index: number, block: DescriptionBlock) => {
    onChange(
      blocks.map((entry, position) =>
        position === index ? { ...entry, block } : entry,
      ),
    );
  };

  const removeAt = (index: number) => {
    onChange(blocks.filter((_, position) => position !== index));
  };

  const moveBy = (index: number, offset: number) => {
    const target = index + offset;

    if (target < 0 || target >= blocks.length) return;

    const reordered = [...blocks];
    const [moved] = reordered.splice(index, 1);

    reordered.splice(target, 0, moved);
    onChange(reordered);
  };

  const addPreset = (preset: BlockPreset) => {
    const added = Array.from({ length: preset.count }, () =>
      emptyBlockOfType(preset.type),
    );

    onChange([...blocks, ...keyDescriptionBlocks(added)]);
  };

  const atBlockLimit = blocks.length >= MAX_BLOCKS;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex list-none flex-col gap-3 p-0">
        {blocks.map((entry, index) => {
          // Destructured so the narrowing below survives into the callbacks:
          // `entry.block` is a property access TypeScript re-widens inside a
          // closure, `block` is a const it does not.
          const { block } = entry;
          const problem = describeBlockProblem(block);
          const run = imageRunAt(
            blocks.map((item) => item.block),
            index,
          );

          return (
            <li
              key={entry.key}
              className="rounded-lg border border-border bg-background p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-ink-muted">
                    {DESCRIPTION_BLOCK_LABELS[block.type]}
                  </span>
                  {run === null ? null : (
                    <span className="text-xs text-muted-foreground">
                      {run.length === 1
                        ? 'Full width on the storefront'
                        : `${run.position} of ${run.length} side by side`}
                    </span>
                  )}
                  {block.type === 'heading' ? (
                    <HeadingLevelSelect
                      id={`${fieldIdPrefix}-${index}-level`}
                      level={block.level}
                      onChange={(level) =>
                        replaceAt(index, { ...block, level })
                      }
                    />
                  ) : null}
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    aria-label={`Move ${DESCRIPTION_BLOCK_LABELS[block.type].toLowerCase()} up`}
                    onClick={() => moveBy(index, -1)}
                  >
                    <ChevronUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={index === blocks.length - 1}
                    aria-label={`Move ${DESCRIPTION_BLOCK_LABELS[block.type].toLowerCase()} down`}
                    onClick={() => moveBy(index, 1)}
                  >
                    <ChevronDown aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${DESCRIPTION_BLOCK_LABELS[block.type].toLowerCase()}`}
                    onClick={() => removeAt(index)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <div className="mt-2">
                <BlockFields
                  fieldKey={`${fieldIdPrefix}-${index}`}
                  block={block}
                  onChange={(next) => replaceAt(index, next)}
                  upload={uploadImage}
                  uploadDisabledReason={uploadDisabledReason}
                />
              </div>

              {problem === null ? null : (
                <p
                  role="status"
                  className="mt-2 flex gap-1.5 text-xs text-amber-600"
                >
                  <TriangleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0"
                  />
                  {problem}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        {BLOCK_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            variant="outline"
            size="sm"
            disabled={atBlockLimit || blocks.length + preset.count > MAX_BLOCKS}
            // Named explicitly: the accessible-name algorithm concatenates
            // trimmed text nodes, so the visible "Image · Full width" is
            // announced as "Image· Full width" — and a middle dot is not
            // something a screen reader should be reading out anyway.
            aria-label={
              preset.hint === undefined
                ? preset.label
                : `${preset.label}, ${preset.hint.toLowerCase()}`
            }
            onClick={() => addPreset(preset)}
          >
            <PresetIcon preset={preset} />
            {preset.label}
            {preset.hint === undefined ? null : (
              <span className="font-normal text-muted-foreground">
                {' · '}
                {preset.hint}
              </span>
            )}
          </Button>
        ))}
      </div>

      {atBlockLimit ? (
        <p className="text-xs text-ink-muted">
          A description holds at most {MAX_BLOCKS} blocks.
        </p>
      ) : null}
    </div>
  );
}
