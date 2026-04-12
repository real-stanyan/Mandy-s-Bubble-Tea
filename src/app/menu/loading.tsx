import { Skeleton } from "@/components/ui/skeleton";

const SECTION_COUNT = 3;
const CARD_COUNT = 3;

export default function Loading() {
  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-8 sm:mb-10">
          <Skeleton className="h-7 w-24 sm:h-9 sm:w-32" />
          <Skeleton className="mt-2 h-4 w-48" />
        </div>

        <div className="space-y-14">
          {Array.from({ length: SECTION_COUNT }).map((_, i) => (
            <section key={i}>
              <div className="mb-5 flex items-baseline justify-between">
                <Skeleton className="h-6 w-32 sm:h-7 sm:w-40" />
                <Skeleton className="h-4 w-20" />
              </div>
              <ul className="grid grid-cols-3 gap-2 sm:gap-5">
                {Array.from({ length: CARD_COUNT }).map((_, j) => (
                  <li key={j}>
                    <CardSkeleton />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="p-3 sm:p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="mt-1.5 h-3 w-1/3" />
        <Skeleton className="mt-2 h-6 w-full rounded-full sm:mt-3 sm:h-7" />
      </div>
    </div>
  );
}
