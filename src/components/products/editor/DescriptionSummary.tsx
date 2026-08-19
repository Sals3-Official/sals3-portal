import { Maximize2, TriangleAlert } from 'lucide-react';
import LinkButton from '@/components/portal/LinkButton';
import {
  DESCRIPTION_BLOCK_LABELS,
  isBlockEmpty,
  type DescriptionBlock,
  type DescriptionBlockType,
} from '@/lib/products/description-blocks';
import InlineRunsText from './InlineRunsText';

/**
 * The description, as a read-only summary on the listing page.
 *
 * The same move the category picker made: once a thing is decided, show the
 * decision compactly and keep the tool that changes it one press away. A
 * description is the longest field on this screen and the only one whose layout
 * matters, and neither fits a column shared with six other sections — so this
 * states what exists and hands off to the full editor.
 *
 * Read-only on purpose. Two editable surfaces over one document, each holding
 * its own copy of it, is how a description save quietly reverts what the other
 * one wrote.
 */

const COUNT_ORDER: DescriptionBlockType[] = [
  'paragraph',
  'heading',
  'bulletList',
  'keyValueList',
  'image',
];

function describeContents(blocks: readonly DescriptionBlock[]): string {
  return COUNT_ORDER.flatMap((type) => {
    const count = blocks.filter((block) => block.type === type).length;

    if (count === 0) return [];

    const label = DESCRIPTION_BLOCK_LABELS[type].toLowerCase();

    return [`${count} ${count === 1 ? label : `${label}s`}`];
  }).join(' · ');
}

type DescriptionSummaryProps = {
  blocks: DescriptionBlock[];
  fullEditorHref: string;
};

export default function DescriptionSummary({
  blocks,
  fullEditorHref,
}: DescriptionSummaryProps) {
  const written = blocks.filter((block) => !isBlockEmpty(block));
  const lead = written.find((block) => block.type === 'paragraph');
  const incomplete = blocks.length - written.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-0 flex-1">
          {written.length === 0 ? (
            <p className="m-0 text-sm font-medium text-ink">
              No description yet
            </p>
          ) : (
            <>
              <p className="m-0 text-xs font-medium tracking-wide text-ink-subtle">
                {describeContents(written)}
              </p>
              {lead === undefined ? null : (
                <p className="mt-1.5 mb-0 line-clamp-2 text-sm leading-relaxed text-ink-muted">
                  <InlineRunsText text={lead.text} runs={lead.runs} />
                </p>
              )}
            </>
          )}
        </div>

        <LinkButton href={fullEditorHref} size="sm" className="shrink-0">
          <Maximize2 aria-hidden="true" className="size-4" />
          {written.length === 0 ? 'Write description' : 'Open full editor'}
        </LinkButton>
      </div>

      {incomplete > 0 ? (
        <p role="status" className="flex gap-1.5 text-xs text-amber-700">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          {incomplete === 1
            ? 'One block is still empty and will not be saved.'
            : `${incomplete} blocks are still empty and will not be saved.`}
        </p>
      ) : null}

      {written.length === 0 ? (
        <p role="status" className="flex gap-1.5 text-xs text-amber-700">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          Empty description. The listing can publish without one, but the
          product page will show only specifications.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Blocks publish in the order set in the full editor. The description
          saves there, separately from this page.
        </p>
      )}
    </div>
  );
}
