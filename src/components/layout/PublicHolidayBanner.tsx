"use client";

import { useEffect, useState } from "react";
import { getActivePublicHoliday } from "@/lib/holiday";
import { PH_SURCHARGE } from "@/lib/constants";

// Site-wide banner shown on QLD public holidays so customers know the
// online surcharge applies before they start ordering. Client-side with
// a 60s re-check so a user who sits on the site across a midnight or
// the Christmas Eve 18:00 cutoff sees the banner appear without a hard
// refresh. Hidden (null) on regular days.
export function PublicHolidayBanner() {
  const [ph, setPh] = useState(() => getActivePublicHoliday());
  useEffect(() => {
    const id = setInterval(() => setPh(getActivePublicHoliday()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!ph) return null;
  return (
    <div className="bg-[#C43A10] px-4 py-2 text-center text-xs font-medium text-white sm:text-sm">
      Today is {ph.name} — a {PH_SURCHARGE.percentage}% public holiday surcharge applies to all online orders.
    </div>
  );
}
