import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Shared "not built yet" notice for an Overview section with no real backend
 * behind it. Says exactly what's missing rather than a fabricated number or
 * an apologetic "coming soon" - a missing figure is never a zero.
 */
export default function OverviewNotYetAvailable({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-dashed border-border bg-muted/40 px-3.5 py-3 text-sm text-muted-foreground">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}
