import { Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { severityForUnresolvedSpecification } from '@/lib/seller-center/product-editor/derive';
import type {
  SpecificationFixture,
  SpecificationRequirement,
} from '@/lib/seller-center/product-editor/types';
import FieldSourceBadge from './FieldSourceBadge';

type SpecificationsSectionProps = {
  specifications: SpecificationFixture[];
  onSpecificationChange: (key: string, value: string) => void;
};

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

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={fieldId}>
          {specification.label}
          {specification.requirement === 'REQUIRED' ? ' *' : ''}
        </Label>
        <FieldSourceBadge source={specification.source} />
      </div>
      <Input
        id={fieldId}
        value={specification.value}
        placeholder={specification.unresolved ? 'No supplier value' : undefined}
        aria-invalid={showsMessage ? true : undefined}
        aria-describedby={showsMessage ? errorId : undefined}
        onChange={(event) => onChange(specification.key, event.target.value)}
      />
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
  specifications,
  onSpecificationChange,
}: SpecificationsSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2.5 text-xs text-ink-muted">
        <Info
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-primary"
        />
        Changing the CJ Category may change which specifications are required.
        Values already entered are kept where the attribute still applies.
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
