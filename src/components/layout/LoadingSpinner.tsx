import { BRAND } from "@/lib/constants";

export function LoadingSpinner({ label = "Brewing…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16">
      <div
        className="h-12 w-12 animate-spin rounded-full border-4 border-solid border-r-transparent"
        style={{ borderColor: BRAND.primaryColor, borderRightColor: "transparent" }}
        role="status"
        aria-label="Loading"
      />
      <p className="text-sm font-medium text-zinc-500">{label}</p>
    </div>
  );
}
