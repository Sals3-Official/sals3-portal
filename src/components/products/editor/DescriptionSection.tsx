'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  descriptionBlocksToPlainText,
  isBlockEmpty,
} from '@/lib/products/description-blocks';
import { keyDescriptionBlocks } from '@/lib/products/keyed-blocks';
import type { DescriptionMode } from '@/lib/products/simple-description';
import DescriptionBlockEditor, {
  type DescriptionImageUpload,
  type KeyedDescriptionBlock,
} from './DescriptionBlockEditor';
import DescriptionModeToggle from './DescriptionModeToggle';
import DescriptionSummary from './DescriptionSummary';
import FieldSourceBadge from './FieldSourceBadge';
import MetaDescriptionField from './MetaDescriptionField';
import SimpleDescriptionEditor from './SimpleDescriptionEditor';

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
  uploadImage?: DescriptionImageUpload;
  uploadDisabledReason?: string | null;
  /**
   * Where the full editor lives for this draft, or `null` when there is no
   * saveable revision behind the screen — a fixture preview. When present, this
   * section becomes a read-only summary and the full editor owns the editing,
   * because two surfaces each holding their own copy of one document is how one
   * quietly reverts the other.
   */
  fullEditorHref?: string | null;
  /** Which editor the seller chose. Owned by the workspace so it saves with the draft. */
  mode: DescriptionMode;
  onModeChange: (mode: DescriptionMode) => void;
  /**
   * Saves this section alone. Absent for a fixture preview, which has no
   * revision to write to.
   */
  onSave?: () => Promise<{ ok: boolean; message: string }>;
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
  uploadImage,
  uploadDisabledReason = null,
  fullEditorHref = null,
  mode,
  onModeChange,
  onSave,
}: DescriptionSectionProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const isEmpty = blocks.every((entry) => isBlockEmpty(entry.block));
  const plainBlocks = blocks.map((entry) => entry.block);
  const isTypingHere = mode === 'simple' || fullEditorHref === null;

  /**
   * Three surfaces over one document, named rather than nested inline: which
   * editor renders depends both on the seller's mode choice and on whether a
   * saveable revision exists behind the screen, and a nested ternary hides that.
   */
  let descriptionEditor;

  if (mode === 'simple') {
    descriptionEditor = (
      <SimpleDescriptionEditor
        blocks={plainBlocks}
        onBlocksChange={(next) => onBlocksChange(keyDescriptionBlocks(next))}
      />
    );
  } else if (fullEditorHref === null) {
    // Designed layout with no saveable revision behind it: a fixture preview, so
    // the blocks are edited in place here rather than on a screen whose save
    // could never succeed.
    descriptionEditor = (
      <DescriptionBlockEditor
        blocks={blocks}
        onChange={onBlocksChange}
        uploadImage={uploadImage}
        uploadDisabledReason={uploadDisabledReason}
      />
    );
  } else {
    descriptionEditor = (
      <DescriptionSummary
        blocks={plainBlocks}
        fullEditorHref={fullEditorHref}
      />
    );
  }

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

        <div className="flex items-center gap-2">
          {/* Revert restores this screen's own unsaved edits. In summary mode
            there are none to restore — the full editor saves its own work — so
            the control is absent rather than permanently disabled. */}
          {/*
           * Shown in both modes. It used to be hidden in the designed layout on
           * the grounds that the full editor saved its own work and there was
           * nothing here to restore — which stopped being true once the mode
           * itself became part of the stored document. Switching editor is a
           * revertible change made on this screen, so the control that undoes it
           * has to be reachable from both sides of the switch.
           */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isUnchanged || isSaving}
            onClick={onRevert}
          >
            <RotateCcw aria-hidden="true" />
            Revert to last saved
          </Button>

          {/*
           * Present in both modes, because both can hold unsaved work: simple
           * text holds what was typed, and the designed layout holds the mode
           * choice itself, which is stored on the document.
           *
           * Saves the description alone. `Save Draft` at the foot of the page
           * still saves everything, and this leaves the title and the prices
           * exactly where the seller left them.
           */}
          {onSave === undefined ? null : (
            <Button
              type="button"
              size="sm"
              disabled={isSaving}
              onClick={() => {
                setIsSaving(true);
                setStatus(null);
                onSave()
                  .then((result) => setStatus(result))
                  .catch(() =>
                    setStatus({
                      ok: false,
                      message: 'The description could not be saved.',
                    }),
                  )
                  .finally(() => setIsSaving(false));
              }}
            >
              {isSaving ? 'Saving…' : 'Save description'}
            </Button>
          )}
        </div>
      </div>

      {status === null ? null : (
        <p
          role="status"
          aria-live="polite"
          className={
            status.ok
              ? 'text-xs text-green-700'
              : 'text-xs font-medium text-red-700'
          }
        >
          {status.message}
        </p>
      )}

      {isTypingHere ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-600/30 bg-warning-surface/50 px-3 py-2.5 text-xs text-ink-muted">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0 text-amber-600"
          />
          The supplier&apos;s own description is raw HTML and is never copied
          into a Sals3 listing — there is no sanitiser to make it safe to
          publish. Write the description here; the storefront renders these
          blocks as plain text, so markup is rejected rather than displayed.
        </p>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <p className="text-sm font-medium">Product description</p>

        <DescriptionModeToggle
          mode={mode}
          blocks={plainBlocks}
          onModeChange={onModeChange}
          onFlatten={(flattened) =>
            onBlocksChange(keyDescriptionBlocks(flattened))
          }
        />

        {descriptionEditor}

        {isEmpty ? (
          <p role="status" className="flex gap-1.5 text-xs text-amber-600">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            Empty description. The listing can publish without one, but the
            storefront will show only specifications.
          </p>
        ) : null}
      </div>

      <MetaDescriptionField
        value={metaDescription}
        onChange={onMetaDescriptionChange}
        isSuggested={isMetaDescriptionSuggested}
        productName={productName}
        fallbackDescription={descriptionBlocksToPlainText(plainBlocks)}
        onSave={onSaveMetaDescription}
      />
    </div>
  );
}
