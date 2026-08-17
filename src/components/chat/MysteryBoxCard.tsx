"use client";

import { useState } from "react";
import { chatUiStrings } from "@/lib/chat/ui-strings";

// The mystery box Mandy offers when a customer asks for a surprise. The
// card is just a CLOSED box — no prize exists until the tap: the open call
// draws server-side (odds in mystery-box.ts, nowhere near this file), so
// nothing the client shows, caches, or replays decides what comes out.
//
// States: closed (shaking, tap me) → opening (brief theatrics) → won
// (confetti + the coupon face + "it's in your Rewards") · already (one a
// day — come back tomorrow) · signin (session gone between offer and tap)
// · error (retryable).

type Phase = "closed" | "opening" | "won" | "already" | "signin" | "error";

type Prize = { label: string; expiresAt: string };

const CONFETTI = ["🎉", "✨", "🧋", "⭐", "🎊", "✨"];

export function MysteryBoxCard({ code }: { code: string }) {
  const t = chatUiStrings();
  const [phase, setPhase] = useState<Phase>("closed");
  const [prize, setPrize] = useState<Prize | null>(null);

  async function open() {
    if (phase !== "closed" && phase !== "error") return;
    setPhase("opening");
    try {
      const res = await fetch("/api/chat/mystery-box/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        label?: string;
        expiresAt?: string;
        reason?: string;
        signIn?: boolean;
      } | null;

      // Let the lid-wiggle play before the reveal lands — the pause IS the
      // suspense.
      await new Promise((r) => setTimeout(r, 700));

      if (res.status === 401 || body?.signIn) {
        setPhase("signin");
        return;
      }
      if (body?.ok && body.label && body.expiresAt) {
        setPrize({ label: body.label, expiresAt: body.expiresAt });
        setPhase("won");
        return;
      }
      if (body?.reason === "already-used" || body?.reason === "invalid-code") {
        // invalid-code here means the code was retired between offer and
        // tap — same customer answer: watch the Instagram for the next one.
        setPhase("already");
        return;
      }
      setPhase("error");
    } catch {
      setPhase("error");
    }
  }

  const expiresLabel = prize
    ? new Date(prize.expiresAt).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        timeZone: "Australia/Brisbane",
      })
    : "";

  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-cream p-4 text-center shadow-card">
      {phase === "won" ? (
        <>
          {/* Confetti burst — decorative, hidden from readers. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-around">
            {CONFETTI.map((c, i) => (
              <span
                key={i}
                className="mystery-confetti text-[16px]"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                {c}
              </span>
            ))}
          </div>
          <div className="mystery-pop">
            <p className="text-[30px] leading-none">🎁</p>
            <p className="mt-2 text-[17px] font-bold text-ink">{prize?.label}</p>
            <p className="mt-1 text-xs text-ink2">
              {t.mysteryInRewards} · {t.mysteryExpires(expiresLabel)}
            </p>
          </div>
        </>
      ) : phase === "already" ? (
        <div className="mystery-pop">
          <p className="text-[30px] leading-none">📦</p>
          <p className="mt-2 text-sm font-bold text-ink">{t.mysteryAlready}</p>
        </div>
      ) : phase === "signin" ? (
        <div>
          <p className="text-[30px] leading-none">🎁</p>
          <p className="mt-2 text-sm font-bold text-ink">{t.mysterySignIn}</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void open()}
          disabled={phase === "opening"}
          className="w-full"
          aria-label={t.mysteryTapAria}
        >
          <span
            className={`inline-block text-[44px] leading-none ${
              phase === "opening" ? "mystery-shake [animation-duration:0.3s]" : "mystery-shake"
            }`}
          >
            🎁
          </span>
          <span className="mt-2 block text-sm font-bold text-ink">
            {phase === "opening"
              ? t.mysteryOpening
              : phase === "error"
                ? t.mysteryError
                : t.mysteryTap}
          </span>
        </button>
      )}
    </div>
  );
}
