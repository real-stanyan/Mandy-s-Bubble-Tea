"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

type State = "idle" | "loading" | "polling" | "added" | "error";

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

async function fetchStatus(): Promise<boolean> {
  try {
    const r = await fetch("/api/wallet/pass/status", { cache: "no-store" });
    if (!r.ok) return false;
    const j = (await r.json()) as { added?: boolean };
    return Boolean(j.added);
  } catch {
    return false;
  }
}

export function AddToWalletButton() {
  const [show, setShow] = useState(false);
  const [state, setState] = useState<State>("idle");
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    setShow(isApplePlatform());
  }, []);

  // Initial server check — pass already added on a previous visit?
  useEffect(() => {
    if (!show) return;
    fetchStatus().then((added) => {
      if (added) setState("added");
    });
  }, [show]);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Poll briefly after the user comes back to this tab — Apple's Wallet sheet
  // hides our page; on return, the device may have registered. Cap at ~30s.
  const startPolling = useCallback(() => {
    stopPolling();
    setState("polling");
    const startedAt = Date.now();
    pollRef.current = window.setInterval(async () => {
      const added = await fetchStatus();
      if (added) {
        stopPolling();
        setState("added");
        return;
      }
      if (Date.now() - startedAt > 30_000) {
        stopPolling();
        setState("idle"); // user cancelled or the device hasn't registered
      }
    }, 2000);
  }, [stopPolling]);

  useEffect(() => {
    function onPageShow() {
      // Coming back from Safari's pass preview — kick off polling if we were
      // mid-flow.
      if (state === "loading" || state === "polling") startPolling();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      stopPolling();
    };
  }, [state, startPolling, stopPolling]);

  if (!show) return null;

  async function onClick() {
    setState("loading");
    try {
      const res = await fetch("/api/wallet/pass/exchange", { method: "POST" });
      if (!res.ok) throw new Error(`exchange ${res.status}`);
      const { token } = (await res.json()) as { token: string };
      // Begin polling now; the navigation away may not actually unload the
      // page on iOS Safari (pkpass is treated as a download).
      startPolling();
      window.location.href = `/api/wallet/pass?token=${encodeURIComponent(token)}`;
    } catch {
      setState("error");
    }
  }

  if (state === "added") {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-5 text-center shadow-sm sm:p-8">
        <p className="text-sm font-medium text-zinc-700">
          ✓ Card saved to Apple Wallet
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5 text-center shadow-sm sm:p-8">
      <button
        type="button"
        onClick={onClick}
        disabled={state === "loading" || state === "polling"}
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
      {state === "polling" && (
        <p className="mt-2 text-xs text-zinc-500">
          Waiting for Wallet to confirm…
        </p>
      )}
      {state === "error" && (
        <p className="mt-2 text-xs text-red-600">
          Couldn&apos;t generate pass. Try again.
        </p>
      )}
    </section>
  );
}
