import LinkButton from '@/components/portal/LinkButton';

/**
 * Which destination's rules this screen is showing and about to write.
 *
 * ADR-015's `Amendment — 2026-08-25` gave both policy tables a destination
 * scope; this is the control that says which one a seller is looking at.
 *
 * ## Links, not client state
 *
 * Each option is a real `<a href="?destination=…">`, the same way sorting and
 * filtering work on the browse and category screens — *"sorting is a
 * navigation, so it survives a reload"*. The scope survives a refresh, is
 * shareable, and the server renders the rules for the scope in the URL rather
 * than the page hydrating and then changing under the reader.
 *
 * It also means the destination the screen **displays** and the destination its
 * Save writes are the same value read from the same place, which is the whole
 * reason `findStoreDefaultForScope` and `listCategoryMarginOverview` take an
 * exact scope rather than resolving one.
 *
 * ## "All destinations" is an option, not an absence
 *
 * A null scope is a real rule that prices every destination without one of its
 * own, so it is the first option and the default — not a cleared filter. Naming
 * it as a choice is what stops a seller reading the unscoped rates as "nothing
 * configured".
 */

export type DestinationOption = {
  /** `null` is the all-destinations rule. */
  code: string | null;
  label: string;
};

export type DestinationScopeSelectorProps = {
  options: DestinationOption[];
  /** The scope currently rendered. `null` is all destinations. */
  selected: string | null;
};

function hrefFor(code: string | null): string {
  return code === null ? '?' : `?destination=${code}`;
}

export default function DestinationScopeSelector({
  options,
  selected,
}: DestinationScopeSelectorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-[10.5px] font-bold tracking-[0.09em] text-ink-subtle uppercase">
        Rules for
      </p>
      <div
        role="group"
        aria-label="Destination these rules apply to"
        className="flex flex-wrap gap-1.5"
      >
        {options.map((option) => {
          const isSelected = option.code === selected;

          return (
            <LinkButton
              key={option.code ?? 'all'}
              href={hrefFor(option.code)}
              size="sm"
              variant={isSelected ? 'default' : 'outline'}
              // The state is in the URL, so the pressed-ness is a real
              // navigation target rather than a styled div a screen reader
              // cannot interpret.
              aria-current={isSelected ? 'true' : undefined}
            >
              {option.label}
            </LinkButton>
          );
        })}
      </div>
      <p className="m-0 text-[11.5px] leading-relaxed text-ink-subtle">
        A destination without its own rule uses the all-destinations rule above
        it. Setting one here changes only that destination.
      </p>
    </div>
  );
}
