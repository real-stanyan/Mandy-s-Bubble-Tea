"use client";

import { useEffect, useState } from "react";
import {
  availablePickupOffsets,
  pickupClockLabel,
} from "@/lib/pickup-schedule";

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
      <p className="mb-2 text-[12.5px] text-ink2">
        What time will you collect your drinks?
      </p>
      <div className="flex flex-wrap gap-2">
        {/* "Now" is not "instantly" — it means we start now, so it's ready
            in about ten minutes. Saying so on the chip stops the pill row
            from reading as five flavours of waiting. */}
        <TimePill
          active={value === 0}
          label="As soon as possible"
          sub="ready in ~10 min"
          onClick={() => onChange(0)}
        />
        {/* A bare "10 min" left customers guessing — is that the wait, or
            the time until I should turn up? (Stan, 2026-08-17.) The clock
            time is the answer to the question actually being asked; the
            offset rides underneath as the shorthand. */}
        {offsets.map((offset) => (
          <TimePill
            key={offset}
            active={value === offset}
            label={now ? pickupClockLabel(offset, now) : `${offset} min`}
            sub={`in ${offset} min`}
            onClick={() => onChange(offset)}
          />
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-ink3">
        {value === 0 || !now
          ? "We'll start making your drinks right away — they'll be at the counter in about 10 minutes."
          : `We'll start making them a few minutes before ${pickupClockLabel(value, now)}, so they're fresh when you arrive. Here early? Tap "I'm here" on your order page and we'll start straight away.`}
      </p>
    </div>
  );
}

function TimePill({
  active,
  label,
  sub,
  onClick,
}: {
  active: boolean;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl px-4 py-2 text-left text-[13px] font-semibold leading-tight transition ${
        active
          ? "border-2 border-brand bg-cream text-brand"
          : "border border-line bg-card text-ink2 hover:border-ink4"
      }`}
    >
      <span className="block">{label}</span>
      <span
        className={`mt-0.5 block text-[10.5px] font-medium ${
          active ? "text-brand/80" : "text-ink3"
        }`}
      >
        {sub}
      </span>
    </button>
  );
}
