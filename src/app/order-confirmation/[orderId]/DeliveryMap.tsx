"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { BRAND } from "@/lib/constants";

export type Tracking = {
  destLat: number | null;
  destLng: number | null;
  storeLat: number;
  storeLng: number;
  driverLat: number | null;
  driverLng: number | null;
  driverHeading: number | null;
  locationUpdatedAt: string | null;
};

type Props = { tracking: Tracking };

// Emoji pin built as a Leaflet divIcon — avoids the classic bundler issue with
// Leaflet's default marker image paths, and keeps us on the brand palette.
function pinHtml(emoji: string, ring: string): string {
  return `<div style="
    display:flex;align-items:center;justify-content:center;
    width:34px;height:34px;border-radius:9999px;
    background:#fff;border:2px solid ${ring};
    box-shadow:0 2px 6px rgba(0,0,0,.25);font-size:18px;line-height:1;
  ">${emoji}</div>`;
}

export function DeliveryMap({ tracking }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const driverMarkerRef = useRef<Marker | null>(null);
  const animRef = useRef<number | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  // Leaflet module, loaded lazily (references window at import time).
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);

  const { destLat, destLng, storeLat, storeLng } = tracking;
  const hasDriver = tracking.driverLat != null && tracking.driverLng != null;

  // One-time map init.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current || mapRef.current) return;
      LRef.current = L;

      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
        dragging: true,
        scrollWheelZoom: false,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      // Store + destination markers (static).
      L.marker([storeLat, storeLng], {
        icon: L.divIcon({
          html: pinHtml("🧋", BRAND.primaryColor),
          className: "",
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
      })
        .addTo(map)
        .bindTooltip("Mandy's");
      if (destLat != null && destLng != null) {
        L.marker([destLat, destLng], {
          icon: L.divIcon({
            html: pinHtml("🏠", "#5B7A52"),
            className: "",
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          }),
        })
          .addTo(map)
          .bindTooltip("Your address");
      }

      mapRef.current = map;
      setReady(true);
      // The map container often has zero height at init time (dynamically
      // imported component, fonts/layout still settling). fitBounds against a
      // zero-size viewport collapses to world zoom — recompute the size and
      // re-fit on the next frame once the div has real dimensions.
      requestAnimationFrame(() => {
        if (mapRef.current !== map) return;
        map.invalidateSize();
        fitAll(L, map);
      });

      // Container can resize after init (header-height offset measured by the
      // parent, orientation change). Keep Leaflet's canvas in sync + re-fit.
      if (containerRef.current && "ResizeObserver" in window) {
        const ro = new ResizeObserver(() => {
          if (mapRef.current !== map) return;
          map.invalidateSize();
          fitAll(L, map);
        });
        ro.observe(containerRef.current);
        roRef.current = ro;
      }
    })();

    return () => {
      cancelled = true;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      roRef.current?.disconnect();
      roRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      driverMarkerRef.current = null;
    };
    // Init once; static markers never change for a given order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fitAll(L: typeof import("leaflet"), map: LeafletMap) {
    const pts: [number, number][] = [[storeLat, storeLng]];
    if (destLat != null && destLng != null) pts.push([destLat, destLng]);
    if (tracking.driverLat != null && tracking.driverLng != null)
      pts.push([tracking.driverLat, tracking.driverLng]);
    if (pts.length === 1) {
      map.setView(pts[0], 15);
    } else {
      const bounds: LatLngBoundsExpression = L.latLngBounds(pts).pad(0.3);
      // maxZoom guards the case where all points are nearly coincident (driver
      // still at the store) — without it fitBounds zooms in to street level on
      // a single pixel. Bottom padding leaves room for the overlay sheet.
      map.fitBounds(bounds, {
        maxZoom: 16,
        paddingTopLeft: [30, 40],
        paddingBottomRight: [30, 260],
      });
    }
  }

  // Move the driver marker whenever a fresh fix arrives, tweening for smoothness.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    if (tracking.driverLat == null || tracking.driverLng == null) return;

    const target: [number, number] = [tracking.driverLat, tracking.driverLng];

    if (!driverMarkerRef.current) {
      driverMarkerRef.current = L.marker(target, {
        icon: L.divIcon({
          html: pinHtml("🛵", BRAND.primaryColor),
          className: "",
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
        zIndexOffset: 1000,
      })
        .addTo(map)
        .bindTooltip("Driver");
      fitAll(L, map);
      return;
    }

    const start = driverMarkerRef.current.getLatLng();
    const from: [number, number] = [start.lat, start.lng];
    const t0 = performance.now();
    const DURATION = 900;
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION);
      const lat = from[0] + (target[0] - from[0]) * p;
      const lng = from[1] + (target[1] - from[1]) * p;
      driverMarkerRef.current?.setLatLng([lat, lng]);
      if (p < 1) animRef.current = requestAnimationFrame(step);
      else fitAll(L, map);
    };
    animRef.current = requestAnimationFrame(step);
  }, [ready, tracking.driverLat, tracking.driverLng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fills its parent — the tracking view positions it full-screen behind the
  // overlay sheet. `hasDriver` is consumed by the overlay's freshness chip.
  void hasDriver;
  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ background: "#E8E5DE" }}
      aria-label="Live delivery map"
    />
  );
}

export function FreshnessBar({
  hasDriver,
  locationUpdatedAt,
}: {
  hasDriver: boolean;
  locationUpdatedAt: string | null;
}) {
  const [, force] = useState(0);
  // Re-render every 10s so the "x ago" label stays honest.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 10000);
    return () => clearInterval(id);
  }, []);

  let label: string;
  if (!hasDriver || !locationUpdatedAt) {
    label = "Waiting for driver location…";
  } else {
    const ageSec = Math.max(
      0,
      Math.round((Date.now() - new Date(locationUpdatedAt).getTime()) / 1000),
    );
    if (ageSec < 15) label = "Live · driver on the way";
    else if (ageSec < 60) label = `Updated ${ageSec}s ago`;
    else label = `Updated ${Math.round(ageSec / 60)}m ago`;
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 shadow-md backdrop-blur">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: hasDriver ? "#5B7A52" : "#C9A227" }}
        aria-hidden="true"
      />
      <p className="text-xs font-semibold text-zinc-700">{label}</p>
    </div>
  );
}
