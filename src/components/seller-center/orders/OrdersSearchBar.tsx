import Link from 'next/link';

type Option = { key: string; label: string };

type OrdersSearchBarProps = {
  fields: Option[];
  activeField: string;
  query: string;
  /** Rendered as hidden inputs so a search keeps the current lane and chips. */
  preservedParams: Record<string, string>;
  resetHref: string;
};

/**
 * Search over the list.
 *
 * A native GET form, deliberately. It needs no client component, no state and
 * no router call: the browser builds the query string, the URL stays the
 * single source of truth for the view, and the whole thing keeps working
 * before hydration. The hidden inputs carry the current lane and chips so
 * searching narrows the view the seller is looking at rather than resetting
 * it.
 */
export default function OrdersSearchBar({
  fields,
  activeField,
  query,
  preservedParams,
  resetHref,
}: OrdersSearchBarProps) {
  return (
    <form
      action="/orders"
      method="get"
      className="flex flex-wrap items-center gap-2"
    >
      {Object.entries(preservedParams).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <select
        aria-label="Search field"
        name="field"
        defaultValue={activeField}
        className="h-9 cursor-pointer rounded-md border border-border bg-card px-2 text-sm text-ink"
      >
        {fields.map((field) => (
          <option key={field.key} value={field.key}>
            {field.label}
          </option>
        ))}
      </select>

      <input
        aria-label="Search orders"
        name="q"
        defaultValue={query}
        placeholder="Search orders"
        className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-sm text-ink placeholder:text-ink-faint"
      />

      <button
        type="submit"
        className="h-9 cursor-pointer rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Search
      </button>
      <Link
        href={resetHref}
        className="h-9 cursor-pointer rounded-md border border-border px-4 text-sm leading-9 text-ink-muted transition-colors hover:border-primary hover:text-primary"
      >
        Reset
      </Link>
    </form>
  );
}
