'use client';

import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';
import type { NavGroup, NavItem } from '@/lib/portal/navigation';
import NavIcon from './NavIcon';

/**
 * Purely decorative branding - not a control. The rail's own toggle button
 * (`SidebarTrigger`, in `PortalTopbar`) is the one obvious, always-visible
 * place to expand/collapse it; a logo doubling as a hidden toggle isn't
 * discoverable and duplicates that button's job.
 */
function SidebarBrand() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center">
      <Image
        src="/brand/sals3-mark.png"
        alt="Sals3"
        width={28}
        height={28}
        className="rounded-md"
      />
    </span>
  );
}

type PortalSidebarProps = {
  groups: NavGroup[];
};

/**
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

function groupContainsPath(group: NavGroup, pathname: string): boolean {
  return group.items.some((item) => isCurrentOrChild(item, pathname));
}

function SubItemLinks({
  items,
  pathname,
}: {
  items: NavItem[];
  pathname: string;
}) {
  return (
    <>
      {items.map((child) => (
        <SidebarMenuSubItem key={child.href}>
          <SidebarMenuSubButton
            size="sm"
            className="group-data-[collapsible=icon]:flex"
            isActive={isCurrent(child.href, pathname)}
            render={
              <Link href={child.href}>
                <span>{child.label}</span>
              </Link>
            }
          />
        </SidebarMenuSubItem>
      ))}
    </>
  );
}

/**
 * Renders one of two entirely different className strings for the same
 * node, chosen by `collapsed` (the same `sidebarState` that drives the
 * rail's own width transition) - not one persistent className built by
 * layering a `group-data-[collapsible=icon]:` conditional override on top
 * of always-present "flat list" classes. That layered approach let a
 * flat-list class (e.g. the `border-l`/`mx-3.5` positioning) and a
 * flyout-override class coexist mid-recalculation, which is what let the
 * sub-list render with a mixed, semi-positioned, visible-when-it-shouldn't-
 * be state (the reported bug). React replaces the whole `className`
 * attribute in one write per render, so there is no state where some old
 * classes and some new classes are both partially in effect.
 */
function NavSubMenu({
  items,
  pathname,
  collapsed,
}: {
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
}) {
  if (collapsed) {
    return (
      // `SidebarMenuItem`'s own `group/menu-item` is the hover trigger.
      <SidebarMenuSub className="absolute left-full top-0 z-50 ml-1 w-44 translate-x-1 rounded-lg border-l-0 bg-sidebar p-1.5 opacity-0 shadow-lg ring-1 ring-sidebar-border transition-all duration-150 invisible group-data-[collapsible=icon]:block group-hover/menu-item:visible group-hover/menu-item:translate-x-0 group-hover/menu-item:opacity-100">
        <SubItemLinks items={items} pathname={pathname} />
      </SidebarMenuSub>
    );
  }

  return (
    <SidebarMenuSub>
      <SubItemLinks items={items} pathname={pathname} />
    </SidebarMenuSub>
  );
}

/**
 * Collapsible nav groups (matching the BOGS Dashboard sidebar pattern): each
 * top-level section starts open only if the current route lives inside it at
 * first render. After that, each section's expand/collapse is independent
 * and only changes when the user clicks its header - closing one section
 * never affects another, and this component stays mounted across
 * client-side navigation, so a section the user left open stays open.
 */
function useGroupOpenState(groups: NavGroup[], pathname: string) {
  return useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      groups.map((group) => [group.label, groupContainsPath(group, pathname)]),
    ),
  );
}

/**
 * Navigation rail. A client component because it reads the current route to
 * mark the active link; the permission-filtered group list comes from the
 * server.
 */
export default function PortalSidebar({ groups }: PortalSidebarProps) {
  const pathname = usePathname();
  const { state: sidebarState } = useSidebar();
  const [openByLabel, setOpenByLabel] = useGroupOpenState(groups, pathname);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex items-center px-3 py-4">
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => {
          // Icon-collapsed rail always shows every icon regardless of a
          // group's own expand/collapse state - only the expanded rail's
          // accordion behavior is allowed to hide items.
          const open =
            sidebarState === 'collapsed' || (openByLabel[group.label] ?? true);

          return (
            <SidebarGroup key={group.label}>
              <Collapsible
                open={open}
                onOpenChange={(next) =>
                  setOpenByLabel((current) => ({
                    ...current,
                    [group.label]: next,
                  }))
                }
              >
                <CollapsibleTrigger className="flex h-8 w-full shrink-0 items-center justify-between rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-hidden ring-sidebar-ring transition-colors duration-200 ease-linear hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0">
                  <span>{group.label}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-3.5 shrink-0 transition-transform duration-200 data-[panel-open]:rotate-180"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            isActive={isCurrentOrChild(item, pathname)}
                            tooltip={
                              item.description === undefined
                                ? item.label
                                : { children: item.description }
                            }
                            render={
                              <Link href={item.href}>
                                <NavIcon name={item.icon} />
                                <span>{item.label}</span>
                              </Link>
                            }
                          />
                          {item.items !== undefined && item.items.length > 0 ? (
                            <NavSubMenu
                              items={item.items}
                              pathname={pathname}
                              collapsed={sidebarState === 'collapsed'}
                            />
                          ) : null}
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </Collapsible>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
