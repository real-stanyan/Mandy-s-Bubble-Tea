import { Skeleton } from "@/components/ui/skeleton";

// Pre-render skeleton for the order detail page, shown during the server-side
// order fetch (Next.js route Suspense). Mirrors page.tsx: header + the
// minmax(0,1fr)/360px grid (min-w-0 columns so it never overflows on mobile),
// order-number box, status card, items list, and the summary sidebar.
function ItemRowSkeleton() {
  return (
    <div className="flex items-center gap-3.5 border-t border-line px-3.5 py-3">
      <Skeleton className="h-[54px] w-[54px] shrink-0 rounded-tile" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-1.5 h-3 w-48" />
      </div>
      <Skeleton className="h-4 w-12 shrink-0" />
    </div>
  );
}

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      {/* header */}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-9 w-52" />
        </div>
        <Skeleton className="h-10 w-28 rounded-full" />
      </div>

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* left */}
        <div className="flex min-w-0 flex-col gap-[18px]">
          <Skeleton className="h-[116px] w-full rounded-card" />
          <Skeleton className="h-[92px] w-full rounded-card" />
          <div className="rounded-card border border-line bg-card p-2 shadow-[0_2px_8px_rgba(42,30,20,0.05)]">
            <Skeleton className="mx-3.5 my-3 h-5 w-16" />
            {Array.from({ length: 3 }).map((_, i) => (
              <ItemRowSkeleton key={i} />
            ))}
          </div>
        </div>

        {/* right */}
        <div className="flex min-w-0 flex-col gap-[18px]">
          <Skeleton className="h-[280px] w-full rounded-card" />
          <Skeleton className="h-[120px] w-full rounded-card" />
        </div>
      </div>
    </main>
  );
}
