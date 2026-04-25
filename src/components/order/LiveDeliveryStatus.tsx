"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { BRAND } from "@/lib/constants";

const LiveDeliveryMap = dynamic(
  () => import("./LiveDeliveryMap").then((m) => m.LiveDeliveryMap),
  { ssr: false, loading: () => <div className="mb-3 h-56 rounded-2xl bg-zinc-100" /> },
);

type LatLng = { lat: number; lng: number };

type Detail = {
  status:
    | "pending"
    | "pickup"
    | "pickup_complete"
    | "dropoff"
    | "delivered"
    | "canceled"
    | "failed"
    | "returned";
  trackingUrl: string;
  pickupEta: string | null;
  dropoffEta: string | null;
  pickup: LatLng | null;
  dropoff: LatLng | null;
  courier: {
    name: string | null;
    phone: string | null;
    vehicleMake: string | null;
    vehicleModel: string | null;
    vehicleColor: string | null;
    location: LatLng | null;
    imgHref: string | null;
  } | null;
};

type Props = { orderId: string };

const POLL_MS = 2_000;

const STATUS_LABEL: Record<Detail["status"], string> = {
  pending: "Looking for a driver…",
  pickup: "Driver heading to the shop",
  pickup_complete: "Driver picked up your order",
  dropoff: "Driver is on the way to you",
  delivered: "Delivered",
  canceled: "Canceled",
  failed: "Delivery failed",
  returned: "Returned to shop",
};

export function LiveDeliveryStatus({ orderId }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/orders/${orderId}/delivery-status`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean } & Detail;
          if (data.ok) setDetail(data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [orderId]);

  if (loading) {
    return (
      <div className="mb-6 rounded-2xl border border-black/5 bg-white p-5 text-center text-sm text-zinc-500 shadow-sm">
        Loading driver info…
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="mb-6 rounded-2xl border border-black/5 bg-white p-5 text-center text-sm text-zinc-500 shadow-sm">
        Driver info will appear here shortly.
      </div>
    );
  }

  const c = detail.courier;
  const dropoffMins = detail.dropoffEta
    ? Math.max(
        0,
        Math.round((new Date(detail.dropoffEta).getTime() - Date.now()) / 60_000),
      )
    : null;

  return (
    <>
      {detail.pickup && detail.dropoff && (
        <LiveDeliveryMap
          pickup={detail.pickup}
          dropoff={detail.dropoff}
          courier={c?.location ?? null}
        />
      )}
    <div className="mb-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        Live Status
      </p>
      <p
        className="mt-1 text-base font-bold"
        style={{ color: BRAND.primaryColor }}
      >
        {STATUS_LABEL[detail.status]}
      </p>

      {c && (
        <div className="mt-4 flex items-center gap-3">
          {c.imgHref ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.imgHref}
              alt={c.name ?? "Driver"}
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-base font-semibold text-zinc-600">
              {(c.name ?? "D").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-zinc-900">
              {c.name ?? "Your driver"}
            </p>
            <p className="text-xs text-zinc-500">
              {[c.vehicleColor, c.vehicleMake, c.vehicleModel]
                .filter(Boolean)
                .join(" ") || "Vehicle info pending"}
            </p>
          </div>
          {c.phone && (
            <a
              href={`tel:${c.phone}`}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-white"
              style={{ backgroundColor: BRAND.primaryColor }}
            >
              Call
            </a>
          )}
        </div>
      )}

      {dropoffMins !== null && detail.status !== "delivered" && (
        <p className="mt-3 text-xs text-zinc-500">
          Arriving in ~{dropoffMins} min
        </p>
      )}

      {detail.trackingUrl && (
        <a
          href={detail.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-xs font-semibold underline"
          style={{ color: BRAND.primaryColor }}
        >
          Open Uber tracking →
        </a>
      )}
    </div>
    </>
  );
}
