import { Skeleton } from "@/components/ui/skeleton";

// Loading skeleton for the Orders surface — mirrors OrdersView's layout (title,
// an in-progress card, then the past-orders grid) so the swap to real content
// doesn't shift. Used both by the route-level loading.tsx and the in-component
// fetch state on /account/orders.
function PastOrderCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-card border border-line bg-card p-[18px]">
      <Skeleton className="h-[56px] w-[56px] shrink-0 rounded-[14px]" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-3 w-40" />
        <Skeleton className="mt-2 h-3 w-28" />
      </div>
      <Skeleton className="h-4 w-12 shrink-0" />
    </div>
  );
}

export function OrdersSkeleton() {
  return (
    <div className="px-4" aria-hidden="true">
      <div className="mb-7">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-3 h-9 w-52" />
      </div>

      {/* in-progress card */}
      <Skeleton className="mb-11 h-[260px] w-full rounded-[22px]" />

      {/* past orders */}
      <div className="mb-4 flex items-baseline justify-between">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <PastOrderCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
