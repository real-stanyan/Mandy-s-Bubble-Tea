"use client";
import dynamic from "next/dynamic";
import type { StoredWeek } from "@/lib/staff/roster/store";

// The board is heavy — the scheduler ships with it — and entirely interactive,
// so it loads on the client. Unlike the old localStorage version this is only
// about weight: the week's data arrives from the server as props, so there is
// nothing to wait for before it can be shown.
const RosterBoard = dynamic(() => import("./board").then((m) => m.RosterBoard), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-zinc-500">
      Loading roster…
    </div>
  ),
});

export function RosterClient({
  weekKey,
  initial,
  loadError,
}: {
  weekKey: string;
  initial: StoredWeek;
  loadError: string | null;
}) {
  return <RosterBoard weekKey={weekKey} initial={initial} loadError={loadError} />;
}
