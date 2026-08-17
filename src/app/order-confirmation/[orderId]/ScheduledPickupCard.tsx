"use client";

import { useState } from "react";

// The scheduled-pickup companion card: shows the collection time the
// customer chose, and the early-arrival escape hatch — "I'm here" releases
// the held kitchen ticket immediately (POST make-now pulls the print
// queue's due time to now; the store's printer picks it up within seconds).
//
// The button reports what actually happened, never what we hoped: the
// make-now route answers "released" only when a held ticket really moved,
// and "already-printing" when the sticker was already out — a double-tap,
// a lapsed hold, or an early counter. Both end states read as good news.

type Props = {
  orderId: string;
  /** Brisbane wall-clock label, e.g. "4:15pm" — computed server-side. */
  pickupLabel: string;
};

type Phase = "idle" | "sending" | "released" | "already" | "failed";

export function ScheduledPickupCard({ orderId, pickupLabel }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");

  async function makeNow() {
    setPhase("sending");
    try {
      const res = await fetch(`/api/orders/${orderId}/make-now`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        outcome?: string;
      } | null;
      if (!res.ok || !body?.ok) {
        setPhase("failed");
        return;
      }
      setPhase(body.outcome === "released" ? "released" : "already");
    } catch {
      setPhase("failed");
    }
  }

  return (
    <div className="rounded-card border border-line bg-card p-4 shadow-[0_2px_8px_rgba(42,30,20,0.05)] sm:p-5">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
        Pickup time you chose
      </p>
      <p className="mt-1.5 text-[15px] font-semibold text-ink">
        Ready at the counter around {pickupLabel}
      </p>

      {phase === "released" ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          The counter&apos;s on it — your drinks are being made now.
        </p>
      ) : phase === "already" ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          Your drinks are already being made — see you at the counter!
        </p>
      ) : (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-ink2">
            We&apos;ll start making your drinks a few minutes before, so
            they&apos;re fresh when you arrive. Here early? Tell us and
            we&apos;ll start now.
          </p>
          <button
            type="button"
            onClick={makeNow}
            disabled={phase === "sending"}
            className="mt-3 inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_10px_18px_rgba(141,85,36,0.28)] transition hover:bg-brand-dark active:scale-[0.97] disabled:opacity-60"
          >
            {phase === "sending" ? "Telling the counter…" : "I'm here — make it now"}
          </button>
          {phase === "failed" ? (
            <p className="mt-2 text-[12px] text-brand">
              That didn&apos;t reach the store — try again, or just ask at the
              counter.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
