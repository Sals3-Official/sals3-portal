'use client';

import { useId } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Plus,
  TriangleAlert,
  Trash2,
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
  MAX_BLOCKS,
  MAX_LIST_ITEMS,
  MAX_TEXT_LENGTH,
  describeBlockProblem,
  emptyBlockOfType,
  type DescriptionBlock,
  type DescriptionBlockType,
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

const ADDABLE_TYPES: DescriptionBlockType[] = [
  'paragraph',
  'heading',
  'bulletList',
  'keyValueList',
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

function BlockFields({
  fieldKey,
  block,
  onChange,
}: {
  fieldKey: string;
  block: DescriptionBlock;
  onChange: (block: DescriptionBlock) => void;
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
};

export default function DescriptionBlockEditor({
  blocks,
  onChange,
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

  const addBlock = (type: DescriptionBlockType) => {
    onChange([...blocks, ...keyDescriptionBlocks([emptyBlockOfType(type)])]);
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
        {ADDABLE_TYPES.map((type) => (
          <Button
            key={type}
            type="button"
            variant="outline"
            size="sm"
            disabled={atBlockLimit}
            onClick={() => addBlock(type)}
          >
            <Plus aria-hidden="true" />
            {DESCRIPTION_BLOCK_LABELS[type]}
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
