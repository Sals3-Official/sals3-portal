function SkeletonLine({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-muted ${className}`}
    />
  );
}

export default function PortalRouteLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading page</span>

      <div className="space-y-2">
        <SkeletonLine className="h-7 w-48" />
        <SkeletonLine className="h-4 w-full max-w-xl" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SkeletonLine className="h-24" />
        <SkeletonLine className="h-24" />
        <SkeletonLine className="h-24" />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <SkeletonLine className="mb-3 h-5 w-40" />
        <div className="space-y-2">
          <SkeletonLine className="h-10 w-full" />
          <SkeletonLine className="h-10 w-full" />
          <SkeletonLine className="h-10 w-full" />
        </div>
      </div>
    </div>
  );
}
