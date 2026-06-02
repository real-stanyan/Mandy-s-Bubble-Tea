"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { coordsAreValid } from "@/lib/places";

export type DeliveryAddress = {
  address: string;
  lat: number;
  lng: number;
  unit: string;
  driverNote: string;
  phone: string;
};

type Props = {
  value: DeliveryAddress;
  onChange: (next: DeliveryAddress) => void;
  defaultPhone?: string;
};

const PLACES_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts: { componentRestrictions?: { country: string }; fields?: string[] },
          ) => {
            addListener: (event: string, cb: () => void) => void;
            getPlace: () => {
              formatted_address?: string;
              geometry?: { location?: { lat: () => number; lng: () => number } };
            };
          };
        };
      };
    };
    initGooglePlaces?: () => void;
  }
}

// Loads the Google Places script once per page. Idempotent — multiple
// instances of this form share the same `<script>` tag. No-op when the
// API key is missing (autocomplete then cannot load, and delivery cannot
// proceed — by design, addresses must be selected, not typed).
function ensureGoogleScript() {
  if (typeof window === "undefined") return;
  if (!PLACES_KEY) return;
  if (window.google?.maps?.places) return;
  if (document.getElementById("google-places-sdk")) return;
  const s = document.createElement("script");
  s.id = "google-places-sdk";
  s.async = true;
  s.src = `https://maps.googleapis.com/maps/api/js?key=${PLACES_KEY}&libraries=places&loading=async`;
  document.head.appendChild(s);
}

export function DeliveryAddressForm({ value, onChange, defaultPhone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  // The formatted_address of the last confirmed Places selection. Manual edits
  // that diverge from this invalidate the captured coordinates.
  const confirmedAddressRef = useRef<string>(
    coordsAreValid(value.lat, value.lng) ? value.address : "",
  );
  const [phoneSeed, setPhoneSeed] = useState(defaultPhone ?? "");

  // Keep refs current so the autocomplete listener (attached once) always
  // reads the latest value/onChange without re-attaching on every re-render.
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [value, onChange]);

  useEffect(() => {
    if (!PLACES_KEY) return;
    ensureGoogleScript();
    let cancelled = false;
    const tryAttach = () => {
      if (cancelled) return;
      if (!window.google?.maps?.places || !inputRef.current) {
        setTimeout(tryAttach, 200);
        return;
      }
      const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: "au" },
        fields: ["formatted_address", "geometry"],
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        const loc = place.geometry?.location;
        if (place.formatted_address && loc) {
          confirmedAddressRef.current = place.formatted_address;
          onChangeRef.current({
            ...valueRef.current,
            address: place.formatted_address,
            lat: loc.lat(),
            lng: loc.lng(),
          });
        }
      });
    };
    tryAttach();
    return () => {
      cancelled = true;
    };
  }, []);

  const confirmed = coordsAreValid(value.lat, value.lng);

  // Manual typing. Mirror the text into state, and invalidate coordinates the
  // moment the text diverges from the confirmed selection. Google writes the
  // chosen text into the input and fires this before `place_changed`; the
  // listener above then re-confirms, so the final state is valid.
  const handleAddressInput = (e: ChangeEvent<HTMLInputElement>) => {
    const typed = e.target.value;
    const diverged = typed !== confirmedAddressRef.current;
    onChange({
      ...value,
      address: typed,
      ...(diverged ? { lat: 0, lng: 0 } : {}),
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Delivery Address
        </label>
        <input
          ref={inputRef}
          type="text"
          placeholder="Start typing your address…"
          defaultValue={value.address}
          onChange={handleAddressInput}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        {!PLACES_KEY ? (
          <p className="mt-1 text-xs text-amber-700">
            Address autocomplete unavailable — delivery needs a selectable address.
          </p>
        ) : confirmed ? (
          <p className="mt-1 text-xs text-emerald-700">✓ Address confirmed</p>
        ) : value.address.trim().length > 0 ? (
          <p className="mt-1 text-xs text-amber-700">
            Pick your address from the suggestions to continue.
          </p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Apartment / Unit (optional)
        </label>
        <input
          type="text"
          value={value.unit}
          onChange={(e) => onChange({ ...value, unit: e.target.value })}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Note for driver (optional)
        </label>
        <textarea
          rows={2}
          maxLength={120}
          value={value.driverNote}
          onChange={(e) => onChange({ ...value, driverNote: e.target.value })}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Phone (required for delivery)
        </label>
        <input
          type="tel"
          value={value.phone || phoneSeed}
          onChange={(e) => {
            setPhoneSeed(e.target.value);
            onChange({ ...value, phone: e.target.value });
          }}
          placeholder="0404 978 238"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}
