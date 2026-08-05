import { Skeleton } from '@/components/ui/skeleton';
import { CJ_PAGE_SIZE } from '@/services/cj/config';

/**
 * Placeholder while the supplier catalogue loads. It reserves the same row
 * height as the real table, so the page does not jump when the rows arrive.
 */
export default function CjTableSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-16 w-full md:w-80" />
      <div className="rounded-lg border border-border bg-card">
        {Array.from({ length: CJ_PAGE_SIZE }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 border-b border-border p-3 last:border-b-0"
          >
            <Skeleton className="size-10 shrink-0 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
      <p className="sr-only">Loading supplier products.</p>
    </div>
  );
}
