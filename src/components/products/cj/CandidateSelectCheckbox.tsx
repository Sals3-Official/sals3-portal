'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { usePipelineSelection } from './PipelineSelectionProvider';

type CandidateSelectCheckboxProps = {
  candidateId: string;
  /** The product name, for the accessible label - never the raw uuid. */
  name: string;
  /** Already drafted into the catalogue: selecting it again is meaningless. */
  disabled: boolean;
};

/**
 * One row's selection checkbox.
 *
 * Safe inside the clickable `CandidateRow`: base-ui's `Checkbox.Root` renders a
 * `<button role="checkbox">`, and the row's `fromNestedControl` guard already
 * ignores clicks on `button` descendants - so checking a row never opens the
 * detail drawer. Pinned by a test in `CandidateRow.test.tsx`.
 */
export default function CandidateSelectCheckbox({
  candidateId,
  name,
  disabled,
}: CandidateSelectCheckboxProps) {
  const { selected, toggle } = usePipelineSelection();

  return (
    <Checkbox
      checked={selected.has(candidateId)}
      onCheckedChange={() => toggle(candidateId)}
      disabled={disabled}
      aria-label={
        disabled ? `${name} is already in the catalogue` : `Select ${name}`
      }
    />
  );
}
