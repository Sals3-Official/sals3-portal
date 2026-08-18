'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Hidden page metadata for search/AI-answer discovery — separate from the
 * buyer-visible Product Description above it (owner scope: narrow, one
 * field plus a preview, not a full SEO control center). Persisted
 * separately (`products.metaDescription`, `save-meta-description.ts`) so a
 * later PDP/storefront task can render it as the page's own
 * `<meta name="description">` without touching PDP body copy.
 *
 * The 140-160 character guidance is exactly that — guidance. Nothing here
 * blocks publish over it, matching the narrow scope this field was asked
 * to stay inside.
 */

const RECOMMENDED_MIN_CHARS = 140;
const RECOMMENDED_MAX_CHARS = 160;
export const META_DESCRIPTION_MAX_CHARS = 320;

type MetaDescriptionFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** True only while the field still holds an unedited auto-suggestion. */
  isSuggested: boolean;
  productName: string;
  /** Shown in the preview when no meta description has been written yet. */
  fallbackDescription: string;
  /**
   * A dedicated save action, same reasoning `CategoryAttributesSection` and
   * `VariantOptionMappingSection` give theirs: this field lives on
   * `products.metaDescription`, a plain compare-and-set column, not on the
   * revisioned draft body the main "Save Draft" button writes — so it needs
   * its own explicit save rather than riding along with that button.
   * Omitted in design-preview mode, where there is nothing real to save to.
   */
  onSave?: () => Promise<{ ok: boolean; message?: string }>;
};

function counterTone(length: number): 'neutral' | 'warning' | 'good' {
  if (length === 0) return 'neutral';

  return length < RECOMMENDED_MIN_CHARS || length > RECOMMENDED_MAX_CHARS
    ? 'warning'
    : 'good';
}

/** Display-only illustration of a URL path — never a real, editable handle. */
function previewPathSegment(productName: string): string {
  const slug = productName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug === '' ? 'product' : slug;
}

export default function MetaDescriptionField({
  value,
  onChange,
  isSuggested,
  productName,
  fallbackDescription,
  onSave,
}: MetaDescriptionFieldProps) {
  const [state, setState] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'FAILED'>(
    'IDLE',
  );
  const [message, setMessage] = useState<string | null>(null);

  const trimmed = value.trim();
  const tone = counterTone(trimmed.length);
  const previewSnippet = trimmed !== '' ? trimmed : fallbackDescription.trim();

  async function handleSave() {
    if (onSave === undefined) return;

    setState('SAVING');
    setMessage(null);

    const result = await onSave();

    setState(result.ok ? 'SAVED' : 'FAILED');
    setMessage(result.message ?? null);
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="editor-meta-description">Meta Description</Label>
          {isSuggested ? (
            <span className="text-xs text-muted-foreground">
              Suggested from your product details — edit anytime
            </span>
          ) : null}
        </div>
        <Textarea
          id="editor-meta-description"
          value={value}
          maxLength={META_DESCRIPTION_MAX_CHARS}
          rows={3}
          aria-describedby="editor-meta-description-help"
          onChange={(event) => {
            onChange(event.target.value);
            // A further edit after a save means "saved" no longer describes
            // what is on screen - the button re-offers itself rather than
            // keep showing a confirmation for text that has since changed.
            if (state !== 'IDLE') setState('IDLE');
          }}
        />
        <p
          id="editor-meta-description-help"
          className="flex flex-wrap justify-between gap-2 text-xs"
        >
          <span className="text-muted-foreground">
            Hidden page metadata for search and AI answer engines — not shown on
            the product page itself.
          </span>
          <span
            className={cn(
              'tabular-nums',
              tone === 'warning' && 'text-amber-600',
              tone === 'good' && 'text-emerald-600',
              tone === 'neutral' && 'text-muted-foreground',
            )}
          >
            {value.length}/{META_DESCRIPTION_MAX_CHARS} · aim for{' '}
            {RECOMMENDED_MIN_CHARS}-{RECOMMENDED_MAX_CHARS}
          </span>
        </p>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
          <Search aria-hidden="true" className="size-3.5" />
          Search preview
        </p>
        <p className="truncate text-sm font-medium text-foreground">
          {productName.trim() !== '' ? productName : 'Untitled product'}
        </p>
        <p className="text-xs text-muted-foreground">
          sals3.com › p › {previewPathSegment(productName)}
        </p>
        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
          {previewSnippet !== ''
            ? previewSnippet
            : 'No description yet — search engines may show an automatically generated snippet instead.'}
        </p>
      </div>

      {onSave !== undefined ? (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={state === 'SAVING'}
            onClick={() => handleSave()}
          >
            {state === 'SAVING' ? 'Saving…' : 'Save Meta Description'}
          </Button>
          {message !== null ? (
            <p
              className={cn(
                'text-sm',
                state === 'FAILED' ? 'text-destructive' : 'text-ink-muted',
              )}
            >
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
