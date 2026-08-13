'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { saveProductDraftAction } from '@/app/(portal)/listings/product-draft-actions';
import { textToDescription } from '@/modules/catalog/products/editor-view';
import type { DescriptionDocument } from '@/modules/catalog/products/description-document';

type RealProductEditorProps = {
  productId: string;
  revisionId: string;
  revisionVersion: number;
  initialTitle: string;
  initialDescriptionText: string;
  /** False when the stored document holds non-paragraph blocks or failed to parse. */
  descriptionEditable: boolean;
  /** Sent back VERBATIM on a title-only save, so structure is never flattened. */
  storedDocument: DescriptionDocument;
};

const SAVE_ERROR_COPY: Record<string, string> = {
  version_conflict: 'This draft changed in another tab - reload to continue.',
  invalid_input:
    'The title or description was rejected - markup and control characters are not allowed.',
  not_found: 'This draft no longer exists. Reload the page.',
  denied: 'Your account cannot edit this draft.',
  rate_limited: 'Too many saves in a row - wait a minute and try again.',
};

/** Title + structured description - the only real write surface today. */
export default function RealProductEditor({
  productId,
  revisionId,
  revisionVersion,
  initialTitle,
  initialDescriptionText,
  descriptionEditable,
  storedDocument,
}: RealProductEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescriptionText);
  const [version, setVersion] = useState(revisionVersion);
  const [saved, setSaved] = useState({
    title: initialTitle,
    description: initialDescriptionText,
  });
  const [pending, startTransition] = useTransition();
  const dirty = title !== saved.title || description !== saved.description;

  const save = () => {
    startTransition(async () => {
      const result = await saveProductDraftAction({
        productId,
        revisionId,
        expectedRevisionVersion: version,
        title: title.trim(),
        descriptionDocument: descriptionEditable
          ? textToDescription(description)
          : storedDocument,
      });

      if (!result.ok) {
        toast.error(SAVE_ERROR_COPY[result.reason] ?? 'The save failed.');

        return;
      }

      setVersion(result.revisionVersion);
      setSaved({ title, description });
      toast('Draft saved.');
    });
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base font-semibold">Basic information</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-title">Product name</Label>
        <Input
          id="product-title"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
        <p className="text-xs text-ink-subtle">
          Shown to customers once publishing exists. Editable.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-description">Description</Label>
        {descriptionEditable ? (
          <Textarea
            id="product-description"
            value={description}
            rows={8}
            onChange={(event) => setDescription(event.target.value)}
          />
        ) : (
          <p className="rounded-md border border-dashed border-border-strong bg-muted px-3 py-2 text-sm text-ink-subtle">
            This description holds structured blocks this editor cannot edit as
            text yet. Saving the title keeps the description exactly as stored.
          </p>
        )}
        <p className="text-xs text-ink-subtle">
          Plain paragraphs separated by blank lines. Markup is rejected, never
          stored. Supplier copy is deliberately not preloaded - the description
          starts as your own words.
        </p>
      </div>
      <div className="flex items-center justify-end gap-3">
        {dirty ? (
          <span className="text-xs text-ink-muted">Unsaved changes</span>
        ) : null}
        <Button onClick={save} disabled={pending || !dirty} aria-busy={pending}>
          {pending ? 'Saving…' : 'Save Draft'}
        </Button>
      </div>
    </section>
  );
}
