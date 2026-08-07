import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import FieldSourceBadge from './FieldSourceBadge';

const DESCRIPTION_MAX = 4000;

type DescriptionSectionProps = {
  description: string;
  supplierDescription: string;
  onDescriptionChange: (value: string) => void;
};

/**
 * The storefront description.
 *
 * Plain text rather than a rich-text editor: supplier HTML has to be
 * sanitised before it is stored or rendered, and no sanitisation backend
 * exists yet. A formatting toolbar here would imply markup survives the
 * round trip, which today it does not - so the screen states what happens
 * instead of pretending it already happens.
 */
export default function DescriptionSection({
  description,
  supplierDescription,
  onDescriptionChange,
}: DescriptionSectionProps) {
  const isEmpty = description.trim() === '';
  const isUnchanged = description === supplierDescription;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldSourceBadge source={isUnchanged ? 'SUPPLIER' : 'SELLER'} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isUnchanged}
          onClick={() => onDescriptionChange(supplierDescription)}
        >
          <RotateCcw aria-hidden="true" />
          Reset to supplier content
        </Button>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-amber-600/30 bg-warning-surface/50 px-3 py-2.5 text-xs text-ink-muted">
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-amber-600"
        />
        Supplier descriptions arrive as raw HTML and are sanitised before they
        are stored or rendered. Unsupported claims and supplier contact details
        are stripped, not published.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="editor-description">Product description</Label>
        <Textarea
          id="editor-description"
          value={description}
          maxLength={DESCRIPTION_MAX}
          rows={10}
          aria-describedby="editor-description-help"
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
        {isEmpty ? (
          <p
            id="editor-description-help"
            role="alert"
            className="flex gap-1.5 text-xs text-amber-600"
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            Empty description. The listing can publish without one, but the
            storefront will show only specifications.
          </p>
        ) : (
          <p
            id="editor-description-help"
            className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"
          >
            <span>
              Recommended order: summary, key features, materials, sizing,
              package contents, care.
            </span>
            <span className="tabular-nums">
              {description.length} / {DESCRIPTION_MAX} characters
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
