"use client";

export type QuoteState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; quoteId: string; etaMin: number; expiresAt: string }
  | { kind: "error"; message: string };

type Props = { state: QuoteState };

export function DeliveryQuoteCard({ state }: Props) {
  if (state.kind === "idle") return null;

  if (state.kind === "loading") {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
        Checking delivery availability…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
        {state.message}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
      ✓ Delivery available · ETA ~{state.etaMin} min
    </div>
  );
}
