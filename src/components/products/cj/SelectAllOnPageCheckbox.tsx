'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { usePipelineSelection } from './PipelineSelectionProvider';

type SelectAllOnPageCheckboxProps = {
  /**
   * Server-computed: this page's candidate ids that are NOT already in the
   * catalogue. Disabled rows can never enter the selection through here.
   */
  eligibleIds: string[];
};

/** Header checkbox: selects or clears every eligible row on this page. */
export default function SelectAllOnPageCheckbox({
  eligibleIds,
}: SelectAllOnPageCheckboxProps) {
  const { selected, setMany } = usePipelineSelection();
  const allSelected =
    eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));

  return (
    <Checkbox
      checked={allSelected}
      onCheckedChange={(checked) => setMany(eligibleIds, checked === true)}
      disabled={eligibleIds.length === 0}
      aria-label={
        allSelected
          ? 'Clear the selection on this page'
          : 'Select every candidate on this page not yet in the catalogue'
      }
    />
  );
}
