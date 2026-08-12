import Link from 'next/link';

type Option = { key: string; label: string };

type OrdersSearchBarProps = {
  fields: Option[];
  activeField: string;
  channels: Option[];
  activeChannel: string;
  query: string;
  /** Rendered as hidden inputs so a search keeps the current lane and chips. */
  preservedParams: Record<string, string>;
  resetHref: string;
};

/**
 * Search and channel filter.
 *
 * A native GET form, deliberately. It needs no client component, no state and
 * no router call: the browser builds the query string, the URL stays the
 * single source of truth for the view, and it works before hydration. The
 * hidden inputs carry the current lane and chips, so searching narrows what
 * the seller is already looking at instead of resetting it.
 */
export default function OrdersSearchBar({
  fields,
  activeField,
  channels,
  activeChannel,
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
        className="h-9 cursor-pointer rounded-md border border-border bg-card px-2.5 text-[13px] text-ink"
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
        type="search"
        defaultValue={query}
        placeholder="Search orders"
        className="h-9 min-w-[220px] flex-1 rounded-md border border-border bg-card px-3 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none"
      />

      <select
        aria-label="Channel"
        name="channel"
        defaultValue={activeChannel}
        className="h-9 cursor-pointer rounded-md border border-border bg-card px-2.5 text-[13px] text-ink"
      >
        {channels.map((channel) => (
          <option key={channel.key} value={channel.key}>
            {channel.label}
          </option>
        ))}
      </select>

      <button
        type="submit"
        className="h-9 cursor-pointer rounded-md bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-brand-900"
      >
        Search
      </button>
      <Link
        href={resetHref}
        className="flex h-9 cursor-pointer items-center rounded-md border border-border px-3 text-[13px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
      >
        Reset
      </Link>
    </form>
  );
}
