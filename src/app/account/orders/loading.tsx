import { Skeleton } from "@/components/ui/skeleton";
import { OrdersSkeleton } from "@/components/account/OrdersSkeleton";

// Route-level pre-render skeleton shown while the Orders page shell loads.
// Mirrors the page's main wrapper + back link; the body reuses OrdersSkeleton.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 pt-10 pb-24">
      <div className="px-4 pt-2 pb-3">
        <Skeleton className="h-4 w-20" />
      </div>
      <OrdersSkeleton />
    </main>
  );
}
