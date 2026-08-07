'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import type { NavGroup, NavItem } from '@/lib/portal/navigation';
import NavIcon from './NavIcon';

type PortalSidebarProps = {
  groups: NavGroup[];
};

/**
 * Marks the active link from the path alone.
 *
 * Reading the query string here would need `useSearchParams`, which forces this
 * client component behind a Suspense boundary and makes the server and the
 * client render the rail differently on a phone. Links that only differ by query
 * string (the review shortcut) are therefore never marked current - a small,
 * honest loss next to a hydration mismatch on every page.
 */
function isCurrent(href: string, pathname: string): boolean {
  return !href.includes('?') && href === pathname;
}

/** A parent with sub-items (e.g. "Qualified Products") reads active when any child does. */
function isCurrentOrChild(item: NavItem, pathname: string): boolean {
  if (isCurrent(item.href, pathname)) return true;

  return (item.items ?? []).some((child) => isCurrent(child.href, pathname));
}

/**
 * Navigation rail. A client component because it reads the current route to
 * mark the active link; the permission-filtered group list comes from the
 * server.
 */
export default function PortalSidebar({ groups }: PortalSidebarProps) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <Link
          href="/overview"
          className="font-display text-base font-semibold tracking-tight text-sidebar-foreground"
        >
          Seller Center
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isCurrentOrChild(item, pathname)}
                      tooltip={item.label}
                      render={
                        <Link href={item.href}>
                          <NavIcon name={item.icon} />
                          <span>{item.label}</span>
                        </Link>
                      }
                    />
                    {item.items !== undefined && item.items.length > 0 ? (
                      <SidebarMenuSub>
                        {item.items.map((child) => (
                          <SidebarMenuSubItem key={child.href}>
                            <SidebarMenuSubButton
                              isActive={isCurrent(child.href, pathname)}
                              render={
                                <Link href={child.href}>
                                  <span>{child.label}</span>
                                </Link>
                              }
                            />
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
