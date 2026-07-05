"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import { AppleLogoIcon } from "@/components/brand/AppleLogoIcon";

type State = "idle" | "loading" | "polling" | "added" | "error";

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
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
        setState("idle");
      }
    }, 2000);
  }, [stopPolling]);

  useEffect(() => {
    function onPageShow() {
      if (state === "loading" || state === "polling") startPolling();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      stopPolling();
    };
  }, [state, startPolling, stopPolling]);

  const onClick = useCallback(async () => {
    if (state === "added") {
      try {
        window.location.href = "shoebox://";
      } catch {
        // no-op
      }
      return;
    }
    setState("loading");
    try {
      const res = await fetch("/api/wallet/pass/exchange", { method: "POST" });
      if (!res.ok) throw new Error(`exchange ${res.status}`);
      const { token } = (await res.json()) as { token: string };
      startPolling();
      window.location.href = `/api/wallet/pass?token=${encodeURIComponent(token)}`;
    } catch {
      setState("error");
    }
  }, [state, startPolling]);

  if (!show) return null;

  const busy = state === "loading" || state === "polling";
  const added = state === "added";
  const subtitle = added
    ? "Added to Apple Wallet"
    : state === "polling"
      ? "Waiting for Wallet to confirm…"
      : state === "loading"
        ? "Preparing your card…"
        : state === "error"
          ? "Couldn't generate pass. Try again."
          : "Scan at the counter — updates automatically";

  // Outer div carries only legacy self-margins (AccountView's <Flush> strips
  // them via [&>*]:!mx-0/!px-0); the visual card lives one level down so its
  // inner padding survives Flush. Root-level p-3 used to get zeroed → icon and
  // button sat flush against the card edges.
  return (
    <div className="mx-4 mt-3">
      <div className="flex items-center gap-3 rounded-card bg-paper p-4 shadow-card">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-tile bg-bg">
          <CreditCard size={20} className="text-ink2" />
        </div>
        <div className="min-w-0 flex-1">
          <span
            className="block font-serif text-ink"
            style={{
              fontSize: 17,
              letterSpacing: -0.3,
              fontWeight: 500,
            }}
          >
            Save your member card
          </span>
          <span className="mt-0.5 block text-ink3" style={{ fontSize: 13 }}>
            {subtitle}
          </span>
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="flex h-9 min-w-[90px] items-center justify-center gap-1.5 rounded-full bg-ink px-3.5 text-white transition active:opacity-80 disabled:opacity-70"
        >
          {busy ? (
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
              aria-label="Loading"
            />
          ) : (
            <>
              <AppleLogoIcon size={14} className="text-white" />
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                {added ? "Open" : "Add to Wallet"}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
