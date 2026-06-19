"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Check, Clock, Phone } from "lucide-react";
import { DELIVERY_DRIVER } from "@/lib/constants";
import { FreshnessBar, type Tracking } from "@/components/delivery/DeliveryMap";
import {
  deriveStatusUi,
  type DispatchStatus,
  type FulfillmentState,
} from "@/lib/order-status-ui";

// Leaflet touches `window` at import time — load the map client-side only.
const DeliveryMap = dynamic(
  () => import("@/components/delivery/DeliveryMap").then((m) => m.DeliveryMap),
  { ssr: false },
);

export type { FulfillmentState } from "@/lib/order-status-ui";

type Props = {
  orderId: string;
  initialState: FulfillmentState | null;
  isDelivery?: boolean;
  initialDispatchStatus?: DispatchStatus | null;
  orderNumber?: string | null;
  deliveryAddress?: string | null;
  etaText?: string | null;
};

const POLL_MS = 5000;

const TERMINAL: ReadonlySet<FulfillmentState> = new Set([
  "COMPLETED",
  "CANCELED",
  "FAILED",
]);

export function OrderStatusHero({
  orderId,
  initialState,
  isDelivery = false,
  initialDispatchStatus = null,
  orderNumber,
  deliveryAddress,
  etaText,
}: Props) {
  const [state, setState] = useState<FulfillmentState | null>(initialState);
  const [dispatchStatus, setDispatchStatus] = useState<DispatchStatus | null>(
    initialDispatchStatus,
  );
  const [tracking, setTracking] = useState<Tracking | null>(null);

  useEffect(() => {
    // Delivery isn't done until it's delivered (fulfillment COMPLETED) — the
    // fulfillment can sit at PROPOSED for a long time while the dispatch status
    // advances, so we keep polling until a terminal fulfillment state.
    if (state && TERMINAL.has(state)) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/status`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          ok: boolean;
          state: FulfillmentState | null;
          dispatchStatus?: DispatchStatus | null;
          tracking: Tracking | null;
        };
        if (cancelled) return;
        if (data.ok && data.state && data.state !== state) {
          setState(data.state);
        }
        if (data.ok) setDispatchStatus(data.dispatchStatus ?? null);
        // tracking is only populated for delivery orders that are PREPARED.
        if (data.ok) setTracking(data.tracking ?? null);
      } catch {
        // Ignore transient network errors — next tick will retry.
      }
    };

    tick(); // fetch immediately so the live map/sheet appears without a 5s wait
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [orderId, state]);

  // Out for delivery → take over the screen with a full-bleed live map and an
  // Uber-Eats-style bottom sheet floating on top. Other states keep the normal
  // in-flow confirmation hero.
  if (isDelivery && state === "PREPARED" && tracking) {
    return (
      <DeliveryTrackingView
        tracking={tracking}
        orderNumber={orderNumber}
        deliveryAddress={deliveryAddress}
        etaText={etaText}
      />
    );
  }

  return (
    <StatusCard
      state={state}
      isDelivery={isDelivery}
      dispatchStatus={dispatchStatus}
      orderNumber={orderNumber}
      etaText={etaText}
    />
  );
}

// One order = one card. The order number and the live status share a single
// bordered shell (number on top, dashed divider, status below) so the
// confirmation reads as a single unit rather than two floating cards. `tone`
// switches the active (gradient + brand border) vs settled (white + line
// border) look.
function CardShell({
  orderNumber,
  isDelivery,
  tone,
  children,
}: {
  orderNumber?: string | null;
  isDelivery: boolean;
  tone: "active" | "muted";
  children: ReactNode;
}) {
  const active = tone === "active";
  return (
    <div
      className={
        "overflow-hidden rounded-card border-[1.5px] " +
        (active
          ? "border-brand shadow-[0_14px_32px_rgba(141,85,36,0.14)]"
          : "border-line bg-card shadow-[0_2px_8px_rgba(42,30,20,0.05)]")
      }
      style={active ? { background: "linear-gradient(180deg,#FFF7EC,#FFF1DE)" } : undefined}
    >
      <div className="flex items-center justify-between gap-4 px-6 pb-5 pt-6">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
            {isDelivery ? "Order number" : "Pickup number"}
          </p>
          <p className="mt-2 whitespace-nowrap font-mono text-[clamp(36px,6vw,52px)] font-bold leading-none tracking-[2px] text-ink">
            {orderNumber || "—"}
          </p>
        </div>
        <span className="max-w-[130px] shrink-0 text-right text-[12.5px] font-semibold leading-snug text-ink3">
          {isDelivery
            ? "Quote this on delivery"
            : "Show this at the counter to collect"}
        </span>
      </div>
      <div
        className="mx-6 border-t border-dashed"
        style={{ borderColor: "rgba(141,85,36,.22)" }}
      />
      <div className="p-6">{children}</div>
    </div>
  );
}

// In-flow status card: a tone pill + a stepper. Pickup shows
// Received → Preparing → Ready; delivery shows Placed → Accepted → Picked up →
// Delivered (driven by the dispatch lifecycle; "Placed" lights up as soon as the
// order is submitted). Completed/canceled get a compact single-line card instead
// of the stepper.
function StatusCard({
  state,
  isDelivery,
  dispatchStatus,
  orderNumber,
  etaText,
}: {
  state: FulfillmentState | null;
  isDelivery: boolean;
  dispatchStatus: DispatchStatus | null;
  orderNumber?: string | null;
  etaText?: string | null;
}) {
  const ui = deriveStatusUi({ state, isDelivery, dispatchStatus });
  // A prep-time ETA ("5–7 mins") is misleading while a delivery order is still
  // placed/awaiting a driver, so only show it once the order is out for delivery
  // (step ≥ 2 now that "Placed" leads the delivery stepper). Pickup keeps its ETA
  // throughout.
  const showEta = !!etaText && !(isDelivery && ui.step < 2);

  if (ui.kind === "completed") {
    return (
      <CardShell orderNumber={orderNumber} isDelivery={isDelivery} tone="muted">
        <div className="flex items-center gap-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-green/15 text-green-dark">
            <Check size={22} />
          </span>
          <div>
            <p className="text-[15.5px] font-bold text-ink">{ui.heading}</p>
            <p className="mt-0.5 text-[13px] text-ink3">{ui.body}</p>
          </div>
        </div>
      </CardShell>
    );
  }

  if (ui.kind === "canceled") {
    return (
      <CardShell orderNumber={orderNumber} isDelivery={isDelivery} tone="muted">
        <div className="flex items-center gap-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink4/10 text-ink3">
            <Check size={22} className="rotate-45" />
          </span>
          <div>
            <p className="text-[15.5px] font-bold text-ink">{ui.heading}</p>
            <p className="mt-0.5 text-[13px] text-ink3">{ui.body}</p>
          </div>
        </div>
      </CardShell>
    );
  }

  // active — unified card: order number on top, then the stepper
  return (
    <CardShell orderNumber={orderNumber} isDelivery={isDelivery} tone="active">
    <div role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white py-1.5 pl-3 pr-3.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{
              backgroundColor: ui.tone === "green" ? "#3CA96E" : "#E0A22E",
              boxShadow:
                ui.tone === "green"
                  ? "0 0 0 4px rgba(60,169,110,.18)"
                  : "0 0 0 4px rgba(224,162,46,.2)",
            }}
          />
          <span
            className="text-[13px] font-bold"
            style={{ color: ui.tone === "green" ? "#2E7D52" : "#9A6B16" }}
          >
            {ui.heading}
          </span>
        </span>
        {showEta && (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand">
            <Clock size={14} /> {etaText}
          </span>
        )}
      </div>

      <p className="mt-3 text-[13.5px] leading-relaxed text-ink2">{ui.body}</p>

      <div className="mt-5 flex items-center gap-2">
        {ui.steps.map((label, i) => {
          const done = i <= ui.step;
          return (
            <div key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              <div className="flex shrink-0 flex-col items-center gap-1.5">
                <span
                  className={
                    "grid h-6 w-6 place-items-center rounded-full text-white " +
                    (done ? "bg-brand" : "border-[1.5px] border-line bg-white")
                  }
                >
                  {done && <Check size={14} />}
                </span>
                <span
                  className={
                    "text-[11.5px] font-semibold " +
                    (done ? "text-ink" : "text-ink4")
                  }
                >
                  {label}
                </span>
              </div>
              {i < ui.steps.length - 1 && (
                <span
                  className={
                    "mb-[18px] h-[2.5px] flex-1 rounded " +
                    (i < ui.step ? "bg-brand" : "bg-line")
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
    </CardShell>
  );
}

// Full-screen live tracker: map fills the viewport, a bottom sheet overlays the
// status + driver + key order info. Mirrors the Uber Eats "on the way" screen.
function DeliveryTrackingView({
  tracking,
  orderNumber,
  deliveryAddress,
  etaText,
}: {
  tracking: Tracking;
  orderNumber?: string | null;
  deliveryAddress?: string | null;
  etaText?: string | null;
}) {
  const hasDriver = tracking.driverLat != null && tracking.driverLng != null;
  // The site header stays in normal flow at the very top; we start the overlay
  // right below it so the header shows over the map (rather than covering it
  // with a full-viewport fixed layer). Measured live so it tracks the header's
  // real height (mobile vs desktop, holiday banner, etc.).
  const [topOffset, setTopOffset] = useState(64);
  // How much of the full-bleed map the bottom sheet covers — fed to the map so
  // it recentres the driver into the visible band above the sheet.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [sheetInset, setSheetInset] = useState(0);

  // Lock background scroll while the overlay owns the screen.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const measure = () => {
      const header = document.querySelector("header");
      const bottom = header?.getBoundingClientRect().bottom ?? 64;
      setTopOffset(Math.max(0, Math.round(bottom)));
      setSheetInset(sheetRef.current?.offsetHeight ?? 0);
    };
    measure();
    // Re-measure after layout settles (web fonts, safe-area insets).
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30"
      style={{ top: topOffset, backgroundColor: "#E8E5DE" }}
    >
      {/* Full-bleed live map. z-0 establishes a stacking context so Leaflet's
          internal panes (z-index up to ~700) stay trapped beneath the overlays. */}
      <div className="absolute inset-0 z-0">
        <DeliveryMap tracking={tracking} bottomInset={sheetInset} />
      </div>

      {/* Top: live freshness chip */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
      >
        <FreshnessBar
          hasDriver={hasDriver}
          locationUpdatedAt={tracking.locationUpdatedAt}
        />
      </div>

      {/* Bottom sheet */}
      <div className="absolute inset-x-0 bottom-0 z-10">
        <div
          ref={sheetRef}
          className="mx-auto max-w-lg rounded-t-3xl bg-card px-5 pt-3 shadow-[0_-8px_30px_rgba(42,30,20,0.18)]"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 18px)" }}
        >
          <div
            className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-bg2"
            aria-hidden="true"
          />
          <h1 className="font-serif text-[22px] font-semibold tracking-[-0.3px] text-brand">
            Out for Delivery!
          </h1>
          <p className="mt-0.5 text-sm text-ink3">
            Your driver is on the way to your address.
          </p>

          <div className="mt-4 border-t border-line pt-4">
            <DriverCard bare />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <InfoTile label="Order Number" value={orderNumber || "—"} accent />
            <InfoTile
              label="ETA"
              value={liveEta(tracking.etaSeconds) ?? (etaText || "Soon")}
            />
          </div>

          <p className="mt-3 text-center text-xs text-ink3">
            <span className="font-semibold text-ink2">Delivering to</span>{" "}
            {deliveryAddress || "Address on file"}
          </p>

          <Link
            href="/"
            className="mt-3 block text-center text-xs font-medium text-ink4"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

// Live ETA from the server's Google Directions duration (re-routed as the
// driver moves). Falls back to the static config copy when unavailable.
function liveEta(etaSeconds: number | null | undefined): string | null {
  if (etaSeconds == null || !Number.isFinite(etaSeconds) || etaSeconds <= 0)
    return null;
  return `~${Math.max(1, Math.ceil(etaSeconds / 60))} min`;
}

function InfoTile({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-tile bg-paper px-3 py-2.5 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-ink4">
        {label}
      </p>
      <p
        className={
          "mt-0.5 truncate font-bold " +
          (accent ? "text-xl text-brand" : "text-base text-ink")
        }
      >
        {value}
      </p>
    </div>
  );
}

// Uber-Eats-style driver strip: avatar, name, one-tap call. `bare` drops the
// outer card chrome for use inside the tracking sheet (already on white).
function DriverCard({ bare = false }: { bare?: boolean }) {
  return (
    <div
      className={
        bare
          ? "flex items-center gap-3"
          : "mb-6 flex items-center gap-3 rounded-card border border-line bg-card p-4 shadow-[0_2px_8px_rgba(42,30,20,0.05)]"
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/driver-avatar.png"
        alt=""
        aria-hidden="true"
        className="h-12 w-12 shrink-0 rounded-full border-2 border-brand bg-white object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink4">
          Your Driver
        </p>
        <p className="truncate text-base font-bold text-ink">
          {DELIVERY_DRIVER.name}
        </p>
        <p className="truncate text-xs text-ink3">On the way with your order</p>
      </div>
      <a
        href={`tel:${DELIVERY_DRIVER.phone}`}
        aria-label={`Call ${DELIVERY_DRIVER.name}`}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition active:scale-95"
        style={{ backgroundColor: "#3CA96E" }}
      >
        <Phone size={20} />
      </a>
    </div>
  );
}

