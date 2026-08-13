'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  CatalogueRowAction,
  CatalogueRowActionsView,
  MenuItemState,
} from '@/lib/seller-center/product-catalogue/view';

type CatalogueRowActionsMenuProps = {
  productName: string;
  actions: CatalogueRowActionsView;
  onAction: (action: CatalogueRowAction) => void;
};

/**
 * Edit link plus the per-row More menu.
 *
 * Every item's presence and enabled-ness arrives pre-resolved as a
 * `MenuItemState`, so this component asks nothing about listing status. That is
 * what lets one menu serve the preview's five-state fictional lifecycle and the
 * real four-state one - the fictional route hides Pause on a draft, the real
 * route shows it disabled with its reason, and neither needs a branch here.
 *
 * The row never performs an action: `onAction` goes back to the owning
 * workspace, which is where a toast (preview) or a server action (real) lives.
 */
export default function CatalogueRowActionsMenu({
  productName,
  actions,
  onAction,
}: CatalogueRowActionsMenuProps) {
  const items: Array<{
    action: CatalogueRowAction;
    label: string;
    state: MenuItemState;
    isDestructive?: boolean;
  }> = [
    { action: 'pause', label: 'Pause listing', state: actions.pause },
    { action: 'resume', label: 'Review & resume', state: actions.resume },
    { action: 'publish', label: 'Publish', state: actions.publish },
    {
      action: 'restore',
      label: 'Restore as new draft',
      state: actions.restore,
    },
    {
      action: 'duplicate',
      label: 'Duplicate as new draft',
      state: actions.duplicate,
    },
    { action: 'viewLive', label: 'View Live Page', state: actions.viewLive },
    {
      action: 'archive',
      label: 'Archive',
      state: actions.archive,
      isDestructive: true,
    },
  ];

  return (
    <div className="flex items-center gap-3">
      <Link
        href={actions.editHref}
        className="text-sm font-medium text-primary hover:underline"
      >
        Edit
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`More actions for ${productName}`}
              className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
            >
              More
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
          }
        />
        <DropdownMenuContent align="end">
          {items.map(({ action, label, state, isDestructive }) =>
            state.kind === 'hidden' ? null : (
              <DropdownMenuItem
                key={action}
                variant={isDestructive ? 'destructive' : undefined}
                disabled={state.kind === 'disabled'}
                onClick={() => {
                  if (state.kind === 'enabled') onAction(action);
                }}
              >
                {label}
                {state.kind === 'disabled' ? state.suffix : null}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
