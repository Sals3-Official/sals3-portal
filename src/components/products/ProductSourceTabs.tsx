import Link from 'next/link';

type ProductSourceTabsProps = {
  source: 'sals3' | 'cj';
};

const TABS = [
  { value: 'sals3', label: 'Sals3 catalogue', href: '/products' },
  {
    value: 'cj',
    label: 'CJdropshipping',
    href: '/products?source=cj',
  },
] as const;

/**
 * Switches between the Sals3 catalogue and the CJdropshipping supplier feed.
 *
 * The two are labelled separately on purpose: CJ products are a supplier
 * catalogue, not Sals3 listings, and showing them in one merged list would
 * misrepresent what the seller actually sells.
 */
export default function ProductSourceTabs({ source }: ProductSourceTabsProps) {
  return (
    <nav aria-label="Choose a product source">
      <ul className="flex w-fit gap-1 rounded-lg border border-border bg-card p-1">
        {TABS.map((tab) => {
          const active = tab.value === source;

          return (
            <li key={tab.value}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-9 items-center rounded-md px-3 text-sm font-medium transition-colors duration-150 ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
