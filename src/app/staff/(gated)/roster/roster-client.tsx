"use client";
import dynamic from "next/dynamic";

// The board's entire content lives in localStorage, so there is nothing
// meaningful for the server to render — and rendering an empty grid on the
// server only to swap in the stored one on hydration is exactly the mismatch
// React warns about. Loading it client-side sidesteps that.
const RosterBoard = dynamic(() => import("./board").then((m) => m.RosterBoard), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-zinc-500">Loading roster…</div>
  ),
});

export function RosterClient({ initialWeekKey }: { initialWeekKey: string }) {
  return <RosterBoard initialWeekKey={initialWeekKey} />;
}
