'use client';

import { Copy } from 'lucide-react';
import copyIdentity from '@/lib/seller-center/copy-identity';
import type { Tracked } from '@/lib/seller-center/product-catalogue/view';
import NotTrackedPill from './NotTrackedPill';

type CopyableIdentityProps = {
  /** Printed before the value, e.g. `Sals3 Product ID` or `CJ · CJ ID`. */
  displayLabel: string;
  /** Named in the copy confirmation and the accessible name. */
  copyLabel: string;
  tracked: Tracked<string>;
};

const LINE_CLASS =
  'mt-0.5 flex items-center gap-1 text-xs text-muted-foreground';

/**
 * One `Label: value` line with a copy affordance - the catalogue prints five of
 * them per expanded row.
 *
 * An untracked or genuinely missing identifier renders as plain text with no
 * button, because a copy control that would put an empty string on the
 * clipboard is worse than no control.
 */
export default function CopyableIdentity({
  displayLabel,
  copyLabel,
  tracked,
}: CopyableIdentityProps) {
  if (tracked.kind !== 'value')
    return (
      <p className={LINE_CLASS}>
        {displayLabel}: <NotTrackedPill tracked={tracked} />
      </p>
    );

  return (
    <button
      type="button"
      onClick={() => copyIdentity(tracked.value, copyLabel)}
      aria-label={`Copy ${copyLabel} ${tracked.value}`}
      className={`${LINE_CLASS} hover:text-foreground`}
    >
      {displayLabel}: {tracked.value}
      <Copy aria-hidden="true" className="size-3" />
    </button>
  );
}
