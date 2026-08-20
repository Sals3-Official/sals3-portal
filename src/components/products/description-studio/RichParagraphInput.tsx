'use client';

/* eslint-disable jsx-a11y/no-autofocus -- Focus follows the block the seller
   just added or selected, so typing can begin immediately. */

import { Bold, Italic } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  applyPlainTextEdit,
  marksInRange,
  plainTextOfRuns,
  runsFromPlainText,
  toggleMarkInRange,
  type InlineMark,
  type InlineRun,
} from '@/lib/products/inline-runs';

/**
 * A paragraph that can be emphasised, edited on a `<textarea>`.
 *
 * A textarea rather than `contentEditable` for two reasons, in this order.
 * It cannot hold markup, so the allow-list posture survives every paste a
 * seller makes — `contentEditable` accepts a pasted DOM tree and the code that
 * strips it back down is a sanitiser by another name. And its selection API is
 * plain integer offsets, which is what `inline-runs` operates on; a DOM range
 * would have to be mapped back onto run boundaries on every keystroke.
 *
 * `contentEditable="plaintext-only"` would allow true in-place styling and is
 * the obvious future move, but Firefox only shipped it in 136. Gating a seller
 * workflow on a browser version is a worse trade than styling the text above
 * the field instead of inside it.
 *
 * The visible emphasis therefore lives in the canvas preview that renders this
 * paragraph, not in the textarea. The textarea is where the words are typed;
 * the canvas immediately above it is where they are seen.
 */

const MARK_BUTTONS: { mark: InlineMark; label: string; icon: typeof Bold }[] = [
  { mark: 'strong', label: 'Bold', icon: Bold },
  { mark: 'em', label: 'Italic', icon: Italic },
];

type RichParagraphInputProps = {
  runs: InlineRun[];
  onChange: (runs: InlineRun[]) => void;
  /** Announced by the toolbar's group, so each paragraph's controls are distinct. */
  blockLabel: string;
  autoFocus?: boolean;
};

export default function RichParagraphInput({
  runs,
  onChange,
  blockLabel,
  autoFocus = false,
}: RichParagraphInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const text = plainTextOfRuns(runs);

  /**
   * Height follows content, so the field never scrolls internally.
   *
   * `field-sizing: content` does this in CSS and is the preferred path, but it
   * is unsupported in Firefox and Safari as of this build, so the height is
   * set here too. Reset to `auto` first: without it `scrollHeight` can only
   * ever grow, and deleting a line would leave the gap behind.
   */
  const resize = useCallback(() => {
    const element = textareaRef.current;

    if (element === null) return;

    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useEffect(resize, [resize, text]);

  const readSelection = useCallback(() => {
    const element = textareaRef.current;

    if (element === null) return;

    setSelection({
      start: element.selectionStart,
      end: element.selectionEnd,
    });
  }, []);

  const state = marksInRange(runs, selection.start, selection.end);
  const hasSelection = selection.end > selection.start;

  function toggle(mark: InlineMark) {
    const element = textareaRef.current;

    if (element === null) return;

    onChange(toggleMarkInRange(runs, selection.start, selection.end, mark));

    // The textarea's value is unchanged by a mark, so React will not restore
    // the selection for us and the caret would jump to the end. Put it back on
    // the same range the seller emphasised, so a second press undoes the first.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(selection.start, selection.end);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="group"
        aria-label={`Emphasis for ${blockLabel}`}
        className="flex items-center gap-1"
      >
        {MARK_BUTTONS.map(({ mark, label, icon: Icon }) => {
          const isActive = state.active.includes(mark);
          const isMixed = state.mixed.includes(mark);

          return (
            <Button
              key={mark}
              type="button"
              variant="outline"
              size="sm"
              // A caret carries no range to emphasise. Disabled rather than
              // silently doing nothing, so the control's state explains why.
              disabled={!hasSelection}
              aria-pressed={isMixed ? 'mixed' : isActive}
              aria-label={label}
              onClick={() => toggle(mark)}
              className={cn(
                'size-8 border-border p-0',
                isActive &&
                  'border-sals3-bright bg-sals3-deep/8 text-sals3-deep',
                isMixed && 'border-sals3-bright border-dashed text-sals3-deep',
              )}
            >
              <Icon aria-hidden="true" className="size-3.5" />
            </Button>
          );
        })}
        <p className="ml-1 text-[11.5px] text-ink-subtle">
          {hasSelection
            ? 'Emphasis applies to the selected words.'
            : 'Select words to emphasise them.'}
        </p>
      </div>

      <textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={text}
        aria-label={blockLabel}
        rows={2}
        onChange={(event) => {
          onChange(
            runs.length === 0
              ? runsFromPlainText(event.target.value)
              : applyPlainTextEdit(runs, event.target.value),
          );
          readSelection();
        }}
        onSelect={readSelection}
        onKeyUp={readSelection}
        onClick={readSelection}
        onFocus={readSelection}
        placeholder="Describe this product in your own words."
        className="field-sizing-content w-full resize-none overflow-hidden rounded-lg border border-input bg-card px-3 py-2 text-[15px] leading-[1.7] text-ink-muted placeholder:text-ink-subtle focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-sals3-bright"
      />
    </div>
  );
}
