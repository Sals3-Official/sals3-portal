import { Skeleton } from '@/components/ui/skeleton';

const SKELETON_ROW_COUNT = 8;

/**
 * Initial-page skeleton (spec section 14). Next.js wraps `page.tsx` in a
 * Suspense boundary automatically because this file exists in the same route
 * segment - no change to `page.tsx` needed. Row height and toolbar shape
 * mirror the real layout so nothing jumps once data arrives.
 */
export default function AllSupplierProductsPreviewLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-8 w-72" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>

      <Skeleton className="h-10 w-full" />

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="ml-auto h-9 w-48" />
      </div>

      <div className="rounded-lg border border-border bg-card">
        {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 border-b border-border p-3 last:border-b-0"
          >
            <Skeleton className="size-10 shrink-0 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>

      <p className="sr-only">Loading the supplier catalog redesign preview.</p>
    </div>
  );
}
