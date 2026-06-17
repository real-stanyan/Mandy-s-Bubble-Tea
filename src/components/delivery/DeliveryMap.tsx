"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Polyline, LatLngBoundsExpression } from "leaflet";
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
  // Driving route driver→destination ([lat, lng] points) + ETA seconds,
  // resolved server-side via Google Directions with a dispatch-row cache.
  // Null until the driver has a GPS fix (or when Directions is unavailable).
  route?: [number, number][] | null;
  etaSeconds?: number | null;
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
  const routeLineRef = useRef<Polyline | null>(null);
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
      // Reserve room at the bottom for the overlay sheet, but cap it at ~38% of
      // the map height so fitBounds always has enough viewport left to actually
      // fit all points (a fixed padding bigger than the viewport breaks the
      // fit). maxZoom guards the case where points are nearly coincident.
      const h = map.getSize().y || 600;
      const bottomPad = Math.min(240, Math.round(h * 0.38));
      map.fitBounds(bounds, {
        maxZoom: 16,
        paddingTopLeft: [30, 40],
        paddingBottomRight: [30, bottomPad],
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

  // Draw / refresh the driving route whenever the server hands us a new one
  // (it re-routes as the driver moves — see delivery-route.ts cache policy).
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    const route = tracking.route;
    if (!route || route.length < 2) {
      routeLineRef.current?.remove();
      routeLineRef.current = null;
      return;
    }
    if (!routeLineRef.current) {
      routeLineRef.current = L.polyline(route, {
        color: BRAND.primaryColor,
        weight: 4,
        opacity: 0.8,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);
    } else {
      routeLineRef.current.setLatLngs(route);
    }
  }, [ready, tracking.route]);

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
  const [label, setLabel] = useState("Waiting for driver location…");
  // Recompute the freshness label off the clock — kept out of render (impure)
  // and refreshed every 10s so the "x ago" copy stays honest.
  useEffect(() => {
    const compute = () => {
      if (!hasDriver || !locationUpdatedAt) {
        setLabel("Waiting for driver location…");
        return;
      }
      const ageSec = Math.max(
        0,
        Math.round((Date.now() - new Date(locationUpdatedAt).getTime()) / 1000),
      );
      if (ageSec < 15) setLabel("Live · driver on the way");
      else if (ageSec < 60) setLabel(`Updated ${ageSec}s ago`);
      else setLabel(`Updated ${Math.round(ageSec / 60)}m ago`);
    };
    compute();
    const id = setInterval(compute, 10000);
    return () => clearInterval(id);
  }, [hasDriver, locationUpdatedAt]);

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
