"use client";

import { useEffect, useState } from "react";
import { Celebration } from "@/components/motion/Celebration";

// Celebrates ONCE, on the first arrival straight from the checkout. The
// checkout drops the order id in sessionStorage before it redirects here;
// we pick it up, clear it, and never celebrate this order again — a
// customer coming back to check on their drink gets a calm page.
// `?placed=1` is the escape hatch for testing and for any client that
// can't reach sessionStorage.

export const JUST_PLACED_KEY = "mbt-just-placed";

export function OrderPlacedCelebration({
  orderId,
  orderNumber,
}: {
  orderId: string;
  orderNumber?: string | null;
}) {
  const [fire, setFire] = useState(false);

  useEffect(() => {
    let placed = false;
    try {
      if (window.sessionStorage.getItem(JUST_PLACED_KEY) === orderId) {
        placed = true;
        window.sessionStorage.removeItem(JUST_PLACED_KEY);
      }
    } catch {
      /* storage unavailable */
    }
    if (!placed) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("placed") === "1") placed = true;
    }
    if (placed) setFire(true);
  }, [orderId]);

  return (
    <Celebration
      active={fire}
      title="Order placed!"
      subtitle={orderNumber ? `Your number is ${orderNumber}` : undefined}
    />
  );
}
