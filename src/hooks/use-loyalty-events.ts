"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

export type LoyaltyEvent = {
  id: string;
  type: string;
  createdAt: string | null;
  accumulatePoints?: { points: number; orderId?: string };
  redeemReward?: { rewardId?: string };
};

export function useLoyaltyEvents(): {
  events: LoyaltyEvent[];
  loading: boolean;
} {
  const { profile } = useAuth();
  const userId = profile?.user_id;
  const [events, setEvents] = useState<LoyaltyEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch("/api/loyalty/events", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok) setEvents(json.events ?? []);
      })
      .catch(() => {
        // Non-fatal
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { events, loading };
}
