import { LoadingSpinner } from "@/components/layout/LoadingSpinner";

export default function Loading() {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <LoadingSpinner />
    </main>
  );
}
