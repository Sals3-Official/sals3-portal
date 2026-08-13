'use client';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type CatalogueFilterSelectProps = {
  id: string;
  /** Visually hidden; the trigger already shows the current value. */
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
  widthClass: string;
  /**
   * When set, the control renders disabled and this explains why on hover.
   * A dimension with no data behind it stays visible: a seller who expects the
   * filter should learn it is not measured, not find it quietly deleted.
   */
  disabledReason?: string;
};

/**
 * One labelled dropdown in the catalogue filter bar.
 *
 * Extracted so the real bar's controls are visually identical to the design
 * preview's without copying the trigger classes, and so "disabled with a
 * reason" is implemented once rather than three times.
 */
export default function CatalogueFilterSelect({
  id,
  label,
  value,
  options,
  onValueChange,
  widthClass,
  disabledReason,
}: CatalogueFilterSelectProps) {
  const items = Object.fromEntries(
    options.map((option) => [option.value, option.label]),
  );
  const control = (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
      disabled={disabledReason !== undefined}
    >
      <SelectTrigger id={id} className={`${widthClass} bg-card`}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      {disabledReason === undefined ? (
        control
      ) : (
        <Tooltip>
          <TooltipTrigger render={<span>{control}</span>} />
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
