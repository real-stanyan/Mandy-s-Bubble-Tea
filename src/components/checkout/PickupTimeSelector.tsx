"use client";

import { useEffect, useState } from "react";
import { availablePickupOffsets } from "@/lib/pickup-schedule";

// "When will you collect it?" — fixed pills, not a time picker. The
// offsets whose pickup time would land after close (10:30pm Brisbane)
// disappear; pickup-schedule.ts owns that rule and the server re-checks
// it, so a stale tab's optimistic pill is refused rather than honoured.
//
// Why this exists: drinks used to be made the minute an order landed, so
// "I'll come in 15" meant melted ice by arrival. A scheduled order holds
// the kitchen ticket until pickup-time minus the make lead instead.

type Props = {
  value: number;
  onChange: (next: number) => void;
};

/** Brisbane wall-clock label for "now + offset minutes" — UTC+10, no DST,
 *  same offset arithmetic the rest of checkout uses. */
function pickupClock(offsetMinutes: number, now: Date): string {
  const bne = new Date(now.getTime() + (offsetMinutes + 600) * 60 * 1000);
  const h24 = bne.getUTCHours();
  const m = bne.getUTCMinutes();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")}${h24 < 12 ? "am" : "pm"}`;
}

export function PickupTimeSelector({ value, onChange }: Props) {
  // The option list depends on the clock, so it must not render on the
  // server (a hydration mismatch at 10:0Xpm would flash pills that then
  // vanish). Mount empty, fill on the client, refresh each minute so a
  // long-open tab sheds pills as closing approaches.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    // First read deferred a frame — a synchronous set inside the effect
    // trips the react-compiler cascading-render rule.
    const raf = requestAnimationFrame(update);
    const timer = setInterval(update, 60 * 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, []);

  const offsets = now ? availablePickupOffsets(now) : [];

  // A picked pill that has since expired must not ride into the order —
  // the server would 409 it anyway; snap back to "now" first.
  useEffect(() => {
    if (now && value !== 0 && !offsets.includes(value)) onChange(0);
  }, [now, value, offsets, onChange]);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <TimePill
          active={value === 0}
          label="Now"
          onClick={() => onChange(0)}
        />
        {offsets.map((offset) => (
          <TimePill
            key={offset}
            active={value === offset}
            label={`${offset} min`}
            onClick={() => onChange(offset)}
          />
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-ink3">
        {value === 0 || !now
          ? "We'll start making your drinks right away."
          : `Pick up around ${pickupClock(value, now)} — we'll start making your drinks a few minutes before, so they're fresh when you arrive.`}
      </p>
    </div>
  );
}

function TimePill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${
        active
          ? "border-2 border-brand bg-cream text-brand"
          : "border border-line bg-card text-ink2 hover:border-ink4"
      }`}
    >
      {label}
    </button>
  );
}
