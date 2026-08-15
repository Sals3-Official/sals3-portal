import { Lock, OctagonAlert, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { severityForUnresolvedSpecification } from '@/lib/seller-center/product-editor/derive';
import { formatDateTime } from '@/lib/seller-center/product-editor/format';
import type {
  SpecificationFixture,
  SpecificationRequirement,
  SupplierSourceIdentity,
} from '@/lib/seller-center/product-editor/types';
import FieldSourceBadge from './FieldSourceBadge';
import ReadOnlyField from './ReadOnlyField';
import SupplierSourceBadge from './SupplierSourceBadge';

type SpecificationsSectionProps = {
  source: SupplierSourceIdentity;
  supplierCategoryPath: string;
  onOpenSourceDrawer: () => void;
  specifications: SpecificationFixture[];
  onSpecificationChange: (key: string, value: string) => void;
};

/**
 * `editorSpecifications()` never produces this key with anything but
 * `SUPPLIER`/`NOT_PROVIDED`/`INFERRED` sources - it is never the seller's to
 * invent (the code comment there says so: "Never SELLER"). So unlike an
 * ordinary missing spec (e.g. a genuinely absent "Country of origin", which a
 * seller may legitimately supply), a *missing* CJ Category stays locked too -
 * there is no value a seller could type here that would be anything but a
 * guess at what the supplier meant.
 */
const NEVER_SELLER_EDITABLE_KEYS = new Set(['category']);

const GROUP_TITLES: Record<SpecificationRequirement, string> = {
  REQUIRED: 'Required specifications',
  RECOMMENDED: 'Recommended specifications',
  OPTIONAL: 'Optional specifications',
};

const GROUP_ORDER: SpecificationRequirement[] = [
  'REQUIRED',
  'RECOMMENDED',
  'OPTIONAL',
];

/**
 * Copy for an empty attribute, by how badly it is actually needed.
 *
 * A required attribute that publication needs is a blocker and says so; a
 * recommended one is a warning that still publishes; an optional one is a
 * suggestion. Showing a genuinely required field as a publishable warning
 * is the specific mistake this mapping exists to prevent - the readiness
 * panel, the section badge and the publish button all read the same rule.
 */
const UNRESOLVED_COPY: Record<SpecificationRequirement, string> = {
  REQUIRED:
    'Publication requires this. It is a hard blocker until a value is entered.',
  RECOMMENDED:
    'The supplier did not provide this. Publishing is not blocked, and the attribute stays empty on the storefront unless you enter it.',
  OPTIONAL: 'Optional. Nothing is blocked and nothing is missing.',
};

type SpecificationFieldProps = {
  specification: SpecificationFixture;
  onChange: (key: string, value: string) => void;
};

/**
 * Read-only surface for a real supplier fact or curated decision, using the
 * same `ReadOnlyField` primitive as the supplier identity block above — but
 * only when there is something to protect. A field with an actual
 * `SUPPLIER`/`INFERRED` value used to render as an editable `<Input>`
 * regardless of source: a seller could select-all and delete "CJ Category"
 * text and see it change on screen, even though nothing was ever wired to
 * save it. That is worse than a no-op — it looks like an edit that
 * silently didn't take, on a field CJ order fulfillment depends on staying
 * exactly what the supplier sent.
 *
 * A genuinely *missing* spec the seller may legitimately supply (e.g.
 * "Country of origin" with no supplier value) stays a real, editable input -
 * `NEVER_SELLER_EDITABLE_KEYS` is the one exception, since a missing CJ
 * Category is still never the seller's to invent.
 */
function SpecificationField({
  specification,
  onChange,
}: SpecificationFieldProps) {
  const fieldId = `spec-${specification.key}`;
  const errorId = `${fieldId}-message`;
  const severity = severityForUnresolvedSpecification(
    specification.requirement,
  );
  const showsMessage = specification.unresolved && severity !== 'SUGGESTION';
  const isBlocker = severity === 'BLOCKER';
  const isLocked =
    specification.source === 'SUPPLIER' ||
    specification.source === 'INFERRED' ||
    NEVER_SELLER_EDITABLE_KEYS.has(specification.key);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        {isLocked ? (
          <span
            id={fieldId}
            className="text-sm leading-none font-medium text-ink-muted"
          >
            {specification.label}
            {specification.requirement === 'REQUIRED' ? ' *' : ''}
          </span>
        ) : (
          <Label htmlFor={fieldId}>
            {specification.label}
            {specification.requirement === 'REQUIRED' ? ' *' : ''}
          </Label>
        )}
        <FieldSourceBadge source={specification.source} />
      </div>
      {isLocked ? (
        <ReadOnlyField
          value={
            specification.unresolved ? 'No supplier value' : specification.value
          }
          ariaLabelledBy={fieldId}
          ariaInvalid={showsMessage ? true : undefined}
          ariaDescribedBy={showsMessage ? errorId : undefined}
        />
      ) : (
        <Input
          id={fieldId}
          value={specification.value}
          placeholder="No supplier value"
          aria-invalid={showsMessage ? true : undefined}
          aria-describedby={showsMessage ? errorId : undefined}
          onChange={(event) => onChange(specification.key, event.target.value)}
        />
      )}
      {showsMessage ? (
        <p
          id={errorId}
          role="alert"
          className={`flex gap-1.5 text-xs ${isBlocker ? 'text-red-600' : 'text-amber-600'}`}
        >
          {isBlocker ? (
            <OctagonAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
          ) : (
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
          )}
          {UNRESOLVED_COPY[specification.requirement]}
        </p>
      ) : null}
    </div>
  );
}

export default function SpecificationsSection({
  source,
  supplierCategoryPath,
  onOpenSourceDrawer,
  specifications,
  onSpecificationChange,
}: SpecificationsSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <SupplierSourceBadge source={source} />

        <div className="grid grid-cols-1 gap-3 @lg:grid-cols-3">
          <ReadOnlyField
            label="Supplier product ID"
            value={source.externalProductId}
            mono
          />
          <ReadOnlyField
            label="Original category"
            value={supplierCategoryPath}
          />
          <ReadOnlyField
            label="Last updated"
            value={
              source.lastSuccessfulSyncAt === null
                ? 'Never synced successfully'
                : formatDateTime(source.lastSuccessfulSyncAt)
            }
          />
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onOpenSourceDrawer}
        >
          View Supplier Source Details
        </Button>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2.5 text-xs text-ink-muted">
        <Lock
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-primary"
        />
        Everything above is supplier-controlled evidence, selectable and
        copyable but not the seller&apos;s to edit. Below, a field with a
        supplier value or a curated category is shown read-only the same way,
        kept exactly as received — a genuinely missing attribute may still be
        entered.
      </p>

      {GROUP_ORDER.map((requirement) => {
        const group = specifications.filter(
          (spec) => spec.requirement === requirement,
        );

        if (group.length === 0) return null;

        return (
          <div key={requirement}>
            <h3 className="mb-2.5 text-[13px] font-semibold">
              {GROUP_TITLES[requirement]}
            </h3>
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
              {group.map((specification) => (
                <SpecificationField
                  key={specification.key}
                  specification={specification}
                  onChange={onSpecificationChange}
                />
              ))}
            </div>
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Attributes the supplier did not send are shown empty. Nothing here is
        filled in on the supplier&apos;s behalf.
      </p>
    </div>
  );
}
