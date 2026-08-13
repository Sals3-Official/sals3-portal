'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { saveProductDraftAction } from '@/app/(portal)/listings/product-draft-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { issuesOfSeverity } from '@/lib/seller-center/product-editor/derive';
import type {
  EditorSectionId,
  ReadinessIssue,
} from '@/lib/seller-center/product-editor/types';
import type { DescriptionDocument } from '@/modules/catalog/products/description-document';
import { textToDescription } from '@/modules/catalog/products/editor-view';
import EditorSectionCard from './EditorSectionCard';
import EditorSectionNavigation from './EditorSectionNavigation';
import ReadinessIssueList from './ReadinessIssueList';
import ReadinessSummary from './ReadinessSummary';

type RealEditorWorkspaceProps = {
  productId: string;
  revisionId: string;
  revisionVersion: number;
  initialTitle: string;
  initialDescriptionText: string;
  /** False when the stored document holds non-paragraph blocks or failed to parse. */
  descriptionEditable: boolean;
  /** Sent back VERBATIM on a title-only save, so structure is never flattened. */
  storedDocument: DescriptionDocument;
  /** Derived from the product's own rows on the server - see `draft-readiness.ts`. */
  issues: ReadinessIssue[];
  /** Server-rendered read-only sections, in the order they appear. */
  basicFacts: ReactNode;
  specsSection: ReactNode;
  variantsSection: ReactNode;
  marketsSection: ReactNode;
  mediaSection: ReactNode;
};

const SAVE_ERROR_COPY: Record<string, string> = {
  version_conflict: 'This draft changed in another tab - reload to continue.',
  invalid_input:
    'The title or description was rejected - markup and control characters are not allowed.',
  not_found: 'This draft no longer exists. Reload the page.',
  denied: 'Your account cannot edit this draft.',
  rate_limited: 'Too many saves in a row - wait a minute and try again.',
};

/**
 * The REAL product editor: seven sections, of which two are genuinely editable.
 *
 * Six pieces of state, not the sixteen its fictional twin
 * (`ProductEditorWorkspace`, kept for `/listings/new?fixture=`) carries. That
 * difference is the whole point: this component holds state ONLY for fields
 * with a write path - the title and the description. Category, brand, SKU,
 * specifications, media order and variant prices are rendered by the server as
 * read-only slots, because giving them inputs would let a seller type into
 * fields whose values have nowhere to go and would silently vanish on reload.
 *
 * There is no Publish button, not even disabled: publication is a separate
 * unbuilt flow with database-enforced gates, and a greyed button implies it
 * works somewhere else.
 */
export default function RealEditorWorkspace({
  productId,
  revisionId,
  revisionVersion,
  initialTitle,
  initialDescriptionText,
  descriptionEditable,
  storedDocument,
  issues,
  basicFacts,
  specsSection,
  variantsSection,
  marketsSection,
  mediaSection,
}: RealEditorWorkspaceProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescriptionText);
  const [version, setVersion] = useState(revisionVersion);
  const [saved, setSaved] = useState({
    title: initialTitle,
    description: initialDescriptionText,
  });
  const [activeSection, setActiveSection] = useState<EditorSectionId>('basic');
  const [pending, startTransition] = useTransition();
  const dirty = title !== saved.title || description !== saved.description;

  const goToSection = (section: EditorSectionId) => {
    setActiveSection(section);
    document
      .getElementById(`sec-${section}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
    <div className="flex flex-col gap-4">
      <ReadinessSummary
        blockerCount={issuesOfSeverity(issues, 'BLOCKER').length}
        warningCount={issuesOfSeverity(issues, 'WARNING').length}
        suggestionCount={issuesOfSeverity(issues, 'SUGGESTION').length}
        lastValidatedAt={null}
      />
      <EditorSectionNavigation
        issues={issues}
        activeSection={activeSection}
        onGoToSection={goToSection}
      />

      <EditorSectionCard
        id="basic"
        title="Basic Information"
        severity="BLOCKER"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-title">Product name</Label>
            <Input
              id="product-title"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
            <p className="text-xs text-ink-subtle">
              Shown to customers once publishing exists. Editable, and saved to
              the database.
            </p>
          </div>
          {basicFacts}
        </div>
      </EditorSectionCard>

      {specsSection}

      <EditorSectionCard
        id="description"
        title="Description"
        severity="BLOCKER"
      >
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
              This description holds structured blocks this editor cannot edit
              as text yet. Saving the title keeps the description exactly as
              stored.
            </p>
          )}
          <p className="text-xs text-ink-subtle">
            Plain paragraphs separated by blank lines. Markup is rejected, never
            stored. Supplier copy is deliberately not preloaded - the
            description starts as your own words.
          </p>
        </div>
      </EditorSectionCard>

      {variantsSection}
      {marketsSection}
      {mediaSection}

      <EditorSectionCard
        id="review"
        title="Before this can publish"
        severity={issues.length === 0 ? null : 'BLOCKER'}
      >
        <ReadinessIssueList
          issues={issues}
          onGoToSection={goToSection}
          maxVisible={null}
        />
        <p className="mt-3 text-xs text-ink-subtle">
          Publishing is a separate flow that does not exist yet, so there is no
          Publish button here - not even a disabled one.
        </p>
      </EditorSectionCard>

      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-card/95 py-3 backdrop-blur">
        {dirty ? (
          <span className="text-xs text-ink-muted">Unsaved changes</span>
        ) : null}
        <Button onClick={save} disabled={pending || !dirty} aria-busy={pending}>
          {pending ? 'Saving…' : 'Save Draft'}
        </Button>
      </div>
    </div>
  );
}
