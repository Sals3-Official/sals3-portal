'use client';

import { usePathname } from 'next/navigation';
import { NAV_GROUPS } from '@/lib/portal/navigation';

function sectionLabelFor(pathname: string): string {
  const group = NAV_GROUPS.find((candidate) =>
    candidate.items.some(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    ),
  );

  return group?.label ?? 'Seller Center';
}

/**
 * Names the current section in the topbar. A client component because it
 * reads the route; the label itself comes from the same `NAV_GROUPS` list
 * that builds the sidebar, so the two can never drift apart.
 */
export default function PortalTopbarSection() {
  const pathname = usePathname();

  return <p className="text-sm font-medium">{sectionLabelFor(pathname)}</p>;
}
