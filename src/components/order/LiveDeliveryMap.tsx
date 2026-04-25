"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BRAND } from "@/lib/constants";

type LatLng = { lat: number; lng: number };

type Props = {
  pickup: LatLng;
  dropoff: LatLng;
  courier: LatLng | null;
};

function pinIcon(emoji: string, bg: string) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:${bg};box-shadow:0 2px 6px rgba(0,0,0,0.25);color:white;font-size:18px;border:2px solid white;">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

export function LiveDeliveryMap({ pickup, dropoff, courier }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const courierMarkerRef = useRef<L.Marker | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    L.marker([pickup.lat, pickup.lng], { icon: pinIcon("🧋", BRAND.primaryColor) })
      .addTo(map)
      .bindTooltip("Mandy's Bubble Tea", { direction: "top", offset: [0, -16] });

    L.marker([dropoff.lat, dropoff.lng], { icon: pinIcon("🏠", "#5B7A52") })
      .addTo(map)
      .bindTooltip("Drop-off", { direction: "top", offset: [0, -16] });

    fitBounds();

    return () => {
      map.remove();
      mapRef.current = null;
      courierMarkerRef.current = null;
      routeLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update / animate courier marker as new positions come in.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!courier) {
      if (courierMarkerRef.current) {
        courierMarkerRef.current.remove();
        courierMarkerRef.current = null;
      }
      if (routeLineRef.current) {
        routeLineRef.current.remove();
        routeLineRef.current = null;
      }
      return;
    }

    const latLng: L.LatLngExpression = [courier.lat, courier.lng];
    if (courierMarkerRef.current) {
      courierMarkerRef.current.setLatLng(latLng);
    } else {
      courierMarkerRef.current = L.marker(latLng, {
        icon: pinIcon("🛵", "#111827"),
        zIndexOffset: 1000,
      }).addTo(map);
    }

    const line: L.LatLngExpression[] = [
      [pickup.lat, pickup.lng],
      latLng,
      [dropoff.lat, dropoff.lng],
    ];
    if (routeLineRef.current) {
      routeLineRef.current.setLatLngs(line);
    } else {
      routeLineRef.current = L.polyline(line, {
        color: BRAND.primaryColor,
        weight: 3,
        opacity: 0.6,
        dashArray: "6 6",
      }).addTo(map);
    }
    fitBounds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courier?.lat, courier?.lng]);

  function fitBounds() {
    const map = mapRef.current;
    if (!map) return;
    const points: L.LatLngExpression[] = [
      [pickup.lat, pickup.lng],
      [dropoff.lat, dropoff.lng],
    ];
    if (courier) points.push([courier.lat, courier.lng]);
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
  }

  return (
    <div
      ref={containerRef}
      className="mb-3 h-56 w-full overflow-hidden rounded-2xl border border-black/5 shadow-sm sm:h-64"
    />
  );
}
