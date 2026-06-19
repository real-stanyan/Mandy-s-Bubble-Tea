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

// `bottomInset` = pixels obscured at the bottom of the map by an overlay (the
// out-for-delivery sheet). The driver is recentred into the visible band above
// it. 0 (default) for the inline mini-map, which has nothing covering it.
type Props = { tracking: Tracking; bottomInset?: number };

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

export function DeliveryMap({ tracking, bottomInset = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const driverMarkerRef = useRef<Marker | null>(null);
  const routeLineRef = useRef<Polyline | null>(null);
  const animRef = useRef<number | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  // Kept in a ref so every fitAll caller (init, resize, driver-move tween) reads
  // the current inset without being re-bound.
  const bottomInsetRef = useRef(0);
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
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
      });
      // Minimal label-free basemap (CARTO "light_nolabels") — a clean pale-grey
      // canvas with no street/suburb names, so the only things the customer
      // reads are our own pins (🧋 🏠 🛵) and the route. The default OSM tiles
      // were too busy. Attribution control is off for the same uncluttered look.
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
        { subdomains: "abcd", maxZoom: 20 },
      ).addTo(map);

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

  // Street-level zoom for the live-driver view — close enough that the 🛵
  // reads clearly (Uber-Eats style), wide enough to keep the surrounding
  // streets and the route for context.
  const DRIVER_ZOOM = 16;

  function fitAll(L: typeof import("leaflet"), map: LeafletMap) {
    const driverLive =
      tracking.driverLat != null && tracking.driverLng != null;
    const hasDest = destLat != null && destLng != null;

    // Once the driver is live (GPS streaming in from the driver app), keep the
    // map centred tightly on the driver and let it follow as new fixes arrive —
    // the customer's question is "where's my driver right now". Fitting the
    // driver→destination span (let alone the far-away shop) would zoom out
    // until the 🛵 is a speck, so we deliberately don't fit the destination
    // here; the route line still points the way to it.
    const h = map.getSize().y || 600;
    // How much of the map's bottom is hidden behind the overlay sheet. Use the
    // measured inset when the parent supplies it, else a sane fraction; cap so a
    // fit/offset still leaves usable viewport.
    const obscured = Math.min(
      bottomInsetRef.current > 0 ? bottomInsetRef.current : Math.round(h * 0.38),
      Math.round(h * 0.45),
    );

    if (driverLive) {
      const driver = L.latLng(tracking.driverLat!, tracking.driverLng!);
      if (obscured > 0) {
        // Shift the map centre DOWN by half the obscured height so the 🛵 lands
        // in the visible band above the sheet (the map is full-bleed behind it).
        const center = map.unproject(
          map.project(driver, DRIVER_ZOOM).add(L.point(0, Math.round(obscured / 2))),
          DRIVER_ZOOM,
        );
        map.setView(center, DRIVER_ZOOM, { animate: false });
      } else {
        map.setView(driver, DRIVER_ZOOM, { animate: false });
      }
      return;
    }

    // Pre-pickup overview: store → destination.
    const pts: [number, number][] = [[storeLat, storeLng]];
    if (hasDest) pts.push([destLat, destLng]);
    if (pts.length === 1) {
      map.setView(pts[0], 15);
    } else {
      const bounds: LatLngBoundsExpression = L.latLngBounds(pts).pad(0.3);
      // Reserve room at the bottom for the overlay sheet (the fraction cap above
      // keeps fitBounds with enough viewport left to actually fit all points — a
      // padding bigger than the viewport breaks the fit). maxZoom guards the case
      // where points are nearly coincident.
      map.fitBounds(bounds, {
        maxZoom: 16,
        paddingTopLeft: [30, 40],
        paddingBottomRight: [30, obscured],
      });
    }
  }

  // Track the obscured-bottom inset; re-fit when the parent measures/changes it
  // so the driver re-centres into the visible band (the sheet height isn't known
  // until after the first layout pass).
  useEffect(() => {
    bottomInsetRef.current = bottomInset;
    if (ready && LRef.current && mapRef.current) {
      fitAll(LRef.current, mapRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomInset, ready]);

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
