import type { ReactNode } from 'react';
import type { InlineMark, InlineRun } from '@/lib/products/inline-runs';

/**
 * A paragraph's emphasis, rendered as elements.
 *
 * Every mark becomes a real React element and nothing is ever interpreted as
 * markup — there is no `dangerouslySetInnerHTML` here and there must never be.
 * That is what makes emphasis safe to store at all: `strong` and `em` arrive
 * as values from a closed enum, so a payload carrying anything else was
 * refused at the write boundary rather than handed to a parser here.
 *
 * Falls back to `text` when `runs` is absent, which is both the common case
 * and the contract: `text` is canonical and `runs` only describes it.
 */

/**
 * Marks nest in a fixed order, outermost first.
 *
 * Fixed rather than payload order so the same paragraph always produces the
 * same tree. `<strong><em>` and `<em><strong>` look identical and read
 * identically to assistive technology, but they are different DOM, and a
 * snapshot or a computed-style assertion would flake between them.
 */
const NESTING_ORDER: InlineMark[] = ['strong', 'em'];

function wrap(children: ReactNode, marks: readonly InlineMark[]): ReactNode {
  return NESTING_ORDER.reduceRight<ReactNode>((inner, mark) => {
    if (!marks.includes(mark)) return inner;

    return mark === 'strong' ? (
      <strong className="font-semibold text-ink">{inner}</strong>
    ) : (
      <em>{inner}</em>
    );
  }, children);
}

type InlineRunsTextProps = {
  text: string;
  runs?: InlineRun[];
};

export default function InlineRunsText({ text, runs }: InlineRunsTextProps) {
  if (runs === undefined || runs.length === 0) return text;

  return runs.map((run, index) => {
    const marks = run.marks ?? [];
    // Index-based keys: runs have no identity of their own, the list is
    // re-rendered whole from one paragraph, and two runs can hold the same
    // text with the same marks only if the normaliser failed to merge them.
    const key = `${index}-${marks.join('')}`;

    if (marks.length === 0) return <span key={key}>{run.text}</span>;

    return <span key={key}>{wrap(run.text, marks)}</span>;
  });
}
