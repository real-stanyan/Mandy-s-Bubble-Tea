"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type State = "idle" | "loading" | "error";

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as Macintosh; treat any Mac with touch support as iPad.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  // Desktop Safari can also open .pkpass natively into Wallet via macOS handoff.
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Firefox/.test(ua)) {
    return true;
  }
  return false;
}

export function AddToWalletButton() {
  const [show, setShow] = useState(false);
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    setShow(isApplePlatform());
  }, []);

  if (!show) return null;

  async function onClick() {
    setState("loading");
    try {
      const res = await fetch("/api/wallet/pass/exchange", { method: "POST" });
      if (!res.ok) throw new Error(`exchange ${res.status}`);
      const { token } = (await res.json()) as { token: string };
      window.location.href = `/api/wallet/pass?token=${encodeURIComponent(token)}`;
    } catch {
      setState("error");
    }
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5 text-center shadow-sm sm:p-8">
      <button
        type="button"
        onClick={onClick}
        disabled={state === "loading"}
        className="inline-block transition active:scale-[0.98] disabled:opacity-50"
        aria-label="Add to Apple Wallet"
      >
        <Image
          src="/add-to-apple-wallet.png"
          alt="Add to Apple Wallet"
          width={200}
          height={63}
          priority={false}
        />
      </button>
      {state === "loading" && (
        <p className="mt-2 text-xs text-zinc-500">Preparing your card…</p>
      )}
      {state === "error" && (
        <p className="mt-2 text-xs text-red-600">
          Couldn&apos;t generate pass. Try again.
        </p>
      )}
    </section>
  );
}
