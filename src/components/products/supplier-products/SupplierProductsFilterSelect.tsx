import FilterSelect, { type FilterOption } from '../FilterSelect';

export type { FilterOption };

type SupplierProductsFilterSelectProps = {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  /** URL parameter this select owns. */
  param: string;
  /** Value that means "no filter" and is therefore removed from the URL. */
  clearedValue: string;
};

/**
 * All Supplier Products' filter select — `FilterSelect` bound to this screen's
 * route and its extra `source` reset.
 *
 * Width is pinned rather than left to the native default: a CJ category option
 * carries its full ancestry ("Pet Supplies › Pet Collars, Harnesses &
 * Accessories › Pet Muzzles"), and an unconstrained select grows to the longest
 * one, which dwarfed every other control in the filter bar. It is pinned WIDER
 * than the search input on purpose — most of those paths fit at this size, and
 * a category the seller cannot read is a filter they cannot trust. The closed
 * control still truncates past it; the open list always shows each option in
 * full.
 */
export default function SupplierProductsFilterSelect({
  id,
  label,
  value,
  options,
  param,
  clearedValue,
}: SupplierProductsFilterSelectProps) {
  return (
    <FilterSelect
      id={id}
      label={label}
      value={value}
      options={options}
      param={param}
      clearedValue={clearedValue}
      path="/products"
      alsoClears={['source']}
      className="md:w-[30rem]"
    />
  );
}
