'use client';

import { ShieldAlert, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Error boundary for Add Product.
 *
 * `requirePermission('product:create')` throws `PermissionError` when the
 * session role does not hold the permission. Without a boundary that lands
 * on the framework's generic error screen, which tells the seller nothing
 * about what happened or what to do. This renders the two cases the screen
 * can actually produce, and nothing more: it never exposes a stack trace,
 * an internal path, or the underlying message for an unexpected failure.
 *
 * Next.js requires an error boundary to be a Client Component.
 */

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AddProductError({ error, reset }: ErrorProps) {
  const isPermissionError = error.name === 'PermissionError';

  if (isPermissionError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card px-6 py-10"
      >
        <ShieldAlert aria-hidden="true" className="size-8 text-amber-600" />
        <h1 className="font-display text-xl font-semibold">
          Your role cannot add products
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Adding a product needs the <code>product:create</code> permission,
          which your role does not hold. Ask an Owner to add the product, or to
          change your role. Nothing was created or changed.
        </p>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card px-6 py-10"
    >
      <TriangleAlert aria-hidden="true" className="size-8 text-red-600" />
      <h1 className="font-display text-xl font-semibold">
        This screen could not be loaded
      </h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        Something went wrong while preparing Add Product. Nothing was saved or
        published. Try again - if it keeps happening, report it with the time
        you saw it.
      </p>
      <Button type="button" variant="outline" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
