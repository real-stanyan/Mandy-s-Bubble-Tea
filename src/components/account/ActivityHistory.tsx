"use client";

import { Gift, Star } from "lucide-react";
import { useLoyaltyEvents } from "@/hooks/use-loyalty-events";
import type { LoyaltyEvent } from "@/hooks/use-loyalty-events";

export function ActivityHistory() {
  const { events, loading } = useLoyaltyEvents();

  return (
    <section className="px-4 mt-5">
      <h2
        className="font-serif text-ink"
        style={{ fontSize: 17, letterSpacing: -0.3, fontWeight: 500 }}
      >
        Activity
      </h2>
      <div className="mt-2 flex flex-col">
        {loading && events.length === 0 ? (
          <p className="text-ink3" style={{ fontSize: 13 }}>
            Loading…
          </p>
        ) : events.length === 0 ? (
          <p className="text-ink3" style={{ fontSize: 13 }}>
            No activity yet.
          </p>
        ) : (
          events.map((event, i) => (
            <EventRow
              key={event.id}
              event={event}
              isLast={i === events.length - 1}
            />
          ))
        )}
      </div>
    </section>
  );
}

function EventRow({ event, isLast }: { event: LoyaltyEvent; isLast: boolean }) {
  const isAccrue = event.type === "ACCUMULATE_POINTS";
  const isRedeem = event.type === "REDEEM_REWARD";
  const label = isAccrue
    ? `Earned ${event.accumulatePoints?.points ?? 1} star${
        (event.accumulatePoints?.points ?? 1) === 1 ? "" : "s"
      }`
    : isRedeem
      ? "Redeemed free drink"
      : humanizeEventType(event.type);
  const Icon = isRedeem ? Gift : Star;
  const iconClass = isRedeem ? "text-ink2" : "text-star";

  return (
    <div
      className={
        "flex items-center gap-3 py-2 " +
        (isLast ? "" : "border-b border-line")
      }
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cream">
        <Icon
          size={16}
          className={iconClass}
          fill={isAccrue ? "currentColor" : "none"}
        />
      </div>
      <div className="min-w-0 flex-1">
        <span className="block text-ink" style={{ fontSize: 13 }}>
          {label}
        </span>
        <span className="mt-0.5 block text-ink3" style={{ fontSize: 11 }}>
          {formatRelative(event.createdAt)}
        </span>
      </div>
    </div>
  );
}

function humanizeEventType(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays < 0) return d.toLocaleDateString("en-AU");
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Intl.DateTimeFormat("en-AU", {
    month: "short",
    day: "numeric",
  }).format(d);
}
