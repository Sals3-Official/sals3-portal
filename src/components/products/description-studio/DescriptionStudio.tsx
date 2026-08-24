'use client';

/* eslint-disable react/jsx-no-bind -- Every handler here closes over the
   block key it acts on, so it cannot be hoisted out of the list it renders. */

import { ChevronLeft, PanelRight, Plus, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import LinkButton from '@/components/portal/LinkButton';
import type { DescriptionImageUpload } from '@/components/products/editor/DescriptionBlockEditor';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  DESCRIPTION_DOCUMENT_VERSION,
  MAX_BLOCKS,
  emptyBlockOfType,
  firstBlockProblem,
  imageRunLengthAt,
  prepareBlocksForSave,
  type DescriptionBlock,
  type DescriptionBlockType,
} from '@/lib/products/description-blocks';
import {
  keyDescriptionBlock,
  keyDescriptionBlocks,
  type KeyedDescriptionBlock,
} from '@/lib/products/keyed-blocks';
import BlockInspector from './BlockInspector';
import BlockPalette, {
  DEFAULT_DESIGN_LAYOUT,
  type PaletteEntry,
} from './BlockPalette';
import StudioCanvas from './StudioCanvas';

/**
 * The description editor, on its own screen.
 *
 * It owns the description and nothing else. The listing editor saves a whole
 * draft — title, category, and every variant price — so opening a second screen
 * that also saved all of that would let a description edit quietly revert a
 * price changed in another tab. This screen's save is the narrow
 * `saveDescriptionAction`, which compare-and-sets the revision the canvas read
 * and touches no other field.
 *
 * That is also why leaving is safe without a prompt: nothing else on the listing
 * is held here, so an abandoned edit loses only what was typed here.
 */

export type SaveDescription = (input: {
  descriptionDocument: {
    version: number;
    mode: 'design';
    blocks: DescriptionBlock[];
  };
}) => Promise<
  { ok: true; revisionVersion: number } | { ok: false; message: string }
>;

type DescriptionStudioProps = {
  productName: string;
  backHref: string;
  initialBlocks: DescriptionBlock[];
  onSave: SaveDescription;
  uploadImage?: DescriptionImageUpload;
  uploadDisabledReason?: string | null;
};

export default function DescriptionStudio({
  productName,
  backHref,
  initialBlocks,
  onSave,
  uploadImage,
  uploadDisabledReason = null,
}: DescriptionStudioProps) {
  /**
   * A description that has never been written opens in the designed layout
   * rather than on a blank canvas.
   *
   * Owner decision 2026-08-24. The empty canvas asked a seller to invent the
   * shape of a product page before writing a word of it, and the shape is not
   * theirs to invent — `Sals3 PDP Redesign v3.1` already decided it, and the
   * storefront renders that and nothing else. The three category templates that
   * used to sit behind a button did not even include a photo, so the arrangement
   * a seller started from was never the one their page was designed around.
   *
   * ## This cannot fabricate a description
   *
   * `DEFAULT_DESIGN_LAYOUT` becomes `emptyBlockOfType` blocks — structure with
   * no text and no image address — and `prepareBlocksForSave` drops every empty
   * block before anything is stored. So a seller who opens this screen and
   * leaves saves the same empty document they arrived with, `blocksMatchSaved`
   * reports no unsaved changes, and nothing reaches a buyer. The seeding is a
   * starting shape, never content, which is the whole reason it is safe to
   * apply without asking.
   *
   * ## Seeded at mount, not in an effect
   *
   * The initialiser runs once per mounted product, so there is no render where
   * the canvas is briefly empty and no effect racing the seller's first
   * keystroke. A saved description is left exactly as stored — the seeding is
   * strictly the empty case.
   */
  const [blocks, setBlocks] = useState<KeyedDescriptionBlock[]>(() =>
    keyDescriptionBlocks(
      initialBlocks.length === 0
        ? DEFAULT_DESIGN_LAYOUT.map(emptyBlockOfType)
        : initialBlocks,
    ),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{
    kind: 'saved' | 'error';
    message: string;
  } | null>(null);

  const selected = blocks.find((entry) => entry.key === selectedKey) ?? null;
  const remaining = MAX_BLOCKS - blocks.length;

  /**
   * What will actually be stored, computed from the same seam the listing editor
   * saves through. Empty blocks are an editing state rather than content, so the
   * count a seller sees here is the count the document will hold.
   */
  const preparedCount = useMemo(
    () => prepareBlocksForSave(blocks.map((entry) => entry.block)).length,
    [blocks],
  );

  function addBlocks(type: DescriptionBlockType, count: number) {
    const added = Array.from({ length: count }, () =>
      keyDescriptionBlock(emptyBlockOfType(type)),
    );

    setBlocks((current) => [...current, ...added]);
    // Select the first of a preset so the inspector opens on something the
    // seller has to fill in — an image row is unusable until alt text exists.
    setSelectedKey(added[0]?.key ?? null);
    setStatus(null);
  }

  function replaceBlock(key: string, block: DescriptionBlock) {
    setBlocks((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, block } : entry)),
    );
    setStatus(null);
  }

  function move(key: string, direction: -1 | 1) {
    setBlocks((current) => {
      const index = current.findIndex((entry) => entry.key === key);
      const target = index + direction;

      if (index === -1 || target < 0 || target >= current.length)
        return current;

      const next = [...current];
      const [moved] = next.splice(index, 1);

      if (moved !== undefined) next.splice(target, 0, moved);

      return next;
    });
    setStatus(null);
  }

  async function save() {
    /**
     * Refuse here, beside the block, rather than at the server boundary.
     *
     * `descriptionDocumentSchema` requires alt text on any stored image, and a
     * document that fails it comes back as one `invalid_input` whose copy names
     * pasted formatting — a cause a seller who simply uploaded a photo never
     * had, and an instruction that cannot fix it. `describeBlockProblem` already
     * knew the real reason and was already rendered in the inspector; it was
     * only ever shown for the block that happened to be selected.
     *
     * Selecting the offending block is the point: the inspector then renders
     * that same sentence next to the field that fixes it.
     */
    const refused = firstBlockProblem(blocks.map((entry) => entry.block));

    if (refused !== null) {
      setSelectedKey(blocks[refused.index]?.key ?? null);
      setStatus({ kind: 'error', message: refused.problem });

      return;
    }

    setIsSaving(true);
    setStatus(null);

    const result = await onSave({
      descriptionDocument: {
        version: DESCRIPTION_DOCUMENT_VERSION,
        // This screen *is* the designed layout, so saving from it records that
        // choice. Without it a document saved here would look mode-less and be
        // inferred from content, which is the ambiguity the field exists to end.
        mode: 'design' as const,
        blocks: prepareBlocksForSave(blocks.map((entry) => entry.block)),
      },
    });

    setIsSaving(false);
    setStatus(
      result.ok
        ? { kind: 'saved', message: 'Description saved.' }
        : { kind: 'error', message: result.message },
    );
  }

  const palette = (
    <BlockPalette
      remaining={remaining}
      canApplyLayout={blocks.length === 0}
      onAdd={(entry: PaletteEntry) => addBlocks(entry.type, entry.count)}
      onApplyLayout={(types) => {
        const added = types.map((type) =>
          keyDescriptionBlock(emptyBlockOfType(type)),
        );

        setBlocks(added);
        setSelectedKey(added[0]?.key ?? null);
        setStatus(null);
      }}
    />
  );

  /**
   * The selected image's adjacency run, so the inspector can name the ratio the
   * page will actually crop it to. Derived from the same rule the canvas groups
   * by rather than a second copy of it.
   */
  const selectedRunLength = imageRunLengthAt(
    blocks.map((entry) => entry.block),
    blocks.findIndex((entry) => entry.key === selectedKey),
  );

  const inspector = (
    <BlockInspector
      runLength={selectedRunLength}
      block={selected?.block ?? null}
      uploadImage={uploadImage}
      uploadDisabledReason={uploadDisabledReason}
      onChange={(block) => {
        if (selected !== null) replaceBlock(selected.key, block);
      }}
    />
  );

  return (
    <div className="flex h-dvh flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        {/* A real anchor styled as a button: Base UI's `Button` warns when
            asked to render anything but a native button, and navigation belongs
            to a link. */}
        <LinkButton
          href={backHref}
          variant="ghost"
          size="sm"
          className="-ml-2 text-sals3-deep"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Back to listing
        </LinkButton>

        <div className="min-w-0">
          <p className="font-display m-0 text-[15px] leading-tight font-semibold text-ink">
            Description
          </p>
          <p className="m-0 truncate text-xs text-ink-subtle">{productName}</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <p
            role="status"
            aria-live="polite"
            className={
              status?.kind === 'error'
                ? 'max-w-[38ch] text-xs text-red-700'
                : 'text-xs text-ink-subtle'
            }
          >
            {status?.message ??
              `${preparedCount} of ${MAX_BLOCKS} blocks will be saved`}
          </p>

          <Sheet>
            <SheetTrigger
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'cursor-pointer lg:hidden',
              )}
            >
              <PanelRight aria-hidden="true" className="size-4" />
              Blocks
            </SheetTrigger>
            <SheetContent side="right" className="w-[320px] overflow-auto p-4">
              <SheetTitle className="mb-4 text-[15px]">Blocks</SheetTitle>
              {palette}
              <hr className="my-5 border-border" />
              {inspector}
            </SheetContent>
          </Sheet>

          <Button
            type="button"
            disabled={isSaving}
            onClick={() => {
              // A rejected action must still clear the saving state, or the
              // button stays disabled with nothing said about why.
              save().catch(() =>
                setStatus({
                  kind: 'error',
                  message: 'The description could not be saved.',
                }),
              );
            }}
            className="bg-sals3-gradient border-0 text-sm font-bold text-white hover:opacity-95"
          >
            {isSaving ? 'Saving…' : 'Save description'}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Add a block"
          className="hidden w-60 shrink-0 overflow-auto border-r border-border p-4 lg:block"
        >
          {palette}
        </aside>

        <main className="min-w-0 flex-1 overflow-auto bg-background px-4 pt-6 pb-24 md:px-6">
          <p className="mx-auto mb-6 flex max-w-[840px] items-start gap-2 rounded-lg border border-amber-600/30 bg-warning-surface/50 px-3 py-2.5 text-xs text-ink-muted">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-amber-600"
            />
            These are your own words. The supplier&apos;s description is raw
            HTML and is never copied into a Sals3 listing — there is no
            sanitiser to make it safe to publish. Bold and italic are stored as
            marks, not as tags, so pasted formatting is rejected rather than
            displayed.
          </p>

          <StudioCanvas
            blocks={blocks}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            onChangeBlock={replaceBlock}
            onMove={move}
            onDuplicate={(key) => {
              const source = blocks.find((entry) => entry.key === key);

              if (source === undefined || remaining < 1) return;

              const copy = keyDescriptionBlock({ ...source.block });

              setBlocks((current) => {
                const index = current.findIndex((entry) => entry.key === key);
                const next = [...current];

                next.splice(index + 1, 0, copy);

                return next;
              });
              setSelectedKey(copy.key);
            }}
            onRemove={(key) => {
              setBlocks((current) => current.filter((e) => e.key !== key));
              setSelectedKey(null);
              setStatus(null);
            }}
          />

          {blocks.length > 0 && remaining > 0 ? (
            <div className="mx-auto mt-6 flex max-w-[840px] items-center gap-2">
              <hr className="flex-1 border-dashed border-border-strong" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addBlocks('paragraph', 1)}
                className="rounded-full text-sals3-deep"
              >
                <Plus aria-hidden="true" />
                Add paragraph
              </Button>
              <hr className="flex-1 border-dashed border-border-strong" />
            </div>
          ) : null}
        </main>

        <aside
          aria-label="Selected block"
          className="hidden w-[300px] shrink-0 overflow-auto border-l border-border p-4 xl:block"
        >
          {inspector}
        </aside>
      </div>
    </div>
  );
}
