"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

// Number of in-progress orders for the signed-in user, used to badge the
// mobile app bar's Orders shortcut and the bottom tab bar's Orders tab
// (matching the phone prototype). An order is "active" while its Square
// state is OPEN — the same rule OrdersView uses to split active vs past.
//
// The result is cached module-wide for 30s and de-duped across callers so
// the two badges share a single /api/orders/history request per navigation.

type HistoryOrder = { state: string | null };

let cache: { at: number; count: number } | null = null;
let inflight: Promise<number> | null = null;
const TTL_MS = 30_000;

async function fetchActiveCount(): Promise<number> {
  const res = await fetch("/api/orders/history", { cache: "no-store" });
  if (!res.ok) return 0;
  const data = (await res.json()) as { orders?: HistoryOrder[] };
  return (data.orders ?? []).filter((o) => o.state === "OPEN").length;
}

function getActiveCount(): Promise<number> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return Promise.resolve(cache.count);
  }
  if (!inflight) {
    inflight = fetchActiveCount()
      .then((count) => {
        cache = { at: Date.now(), count };
        inflight = null;
        return count;
      })
      .catch(() => {
        inflight = null;
        return cache?.count ?? 0;
      });
  }
  return inflight;
}

export function useActiveOrderCount(): number {
  const { profile } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    getActiveCount().then((c) => {
      if (!cancelled) setCount(c);
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  // Logged out → no active orders to show.
  return profile ? count : 0;
}
