"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { coordsAreValid, type PlacesHealth } from "@/lib/places";
import { PLACES_KEY, waitForPlaces } from "@/lib/google-places";
import { extractPostcode, isDeliverablePostcode } from "@/lib/delivery-zone";
import { BUSINESS, DELIVERABLE_POSTCODES } from "@/lib/constants";

export type DeliveryAddress = {
  address: string;
  lat: number;
  lng: number;
  unit: string;
  driverNote: string;
  phone: string;
  postcode: string;
};

type Props = {
  value: DeliveryAddress;
  onChange: (next: DeliveryAddress) => void;
  defaultPhone?: string;
  /** Whether Places can confirm an address at all right now — see
   *  `usePlacesHealth`. "down" means no delivery order can be placed, and
   *  saying so is the whole point: the customer cannot fix it by retyping. */
  health?: PlacesHealth;
};

export function DeliveryAddressForm({
  value,
  onChange,
  defaultPhone,
  health = "loading",
}: Props) {
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
    let cancelled = false;
    // waitForPlaces gives up after a bounded wait; the old inline retry
    // polled every 200ms forever when the SDK never loaded.
    void waitForPlaces().then((loaded) => {
      if (cancelled || !loaded || !inputRef.current) return;
      const places = window.google?.maps?.places;
      if (!places) return;
      const ac = new places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: "au" },
        fields: ["formatted_address", "geometry", "address_components"],
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        const loc = place.geometry?.location;
        if (place.formatted_address && loc) {
          confirmedAddressRef.current = place.formatted_address;
          const pc = extractPostcode(place.address_components);
          onChangeRef.current({
            ...valueRef.current,
            address: place.formatted_address,
            lat: loc.lat(),
            lng: loc.lng(),
            // Prefill from the selected address; the user can still edit it.
            ...(pc ? { postcode: pc } : {}),
          });
        }
      });
    });
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

  // Places is dead (no key, blocked script, lapsed billing, revoked key). No
  // typing can rescue this, so the form stops pretending it is the customer's
  // move and hands them the two things that still work.
  const placesDown = !PLACES_KEY || health === "down";

  return (
    <div className="space-y-3">
      {placesDown ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-semibold">Address lookup is down right now</p>
          <p className="mt-1">
            We can&apos;t confirm delivery addresses until it&apos;s back, so
            delivery orders can&apos;t be placed. Switch to Pickup above, or
            call us on{" "}
            <a href={`tel:${BUSINESS.phone.replace(/\s/g, "")}`} className="underline">
              {BUSINESS.phone}
            </a>{" "}
            and we&apos;ll take the order by phone.
          </p>
        </div>
      ) : null}
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
        {placesDown ? null : confirmed ? (
          <p className="mt-1 text-xs text-emerald-700">✓ Address confirmed</p>
        ) : value.address.trim().length > 0 ? (
          <p className="mt-1 text-xs text-amber-700">
            Pick your address from the suggestions to continue.
          </p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Postcode (required for delivery)
        </label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={value.postcode}
          onChange={(e) =>
            onChange({
              ...value,
              postcode: e.target.value.replace(/\D/g, "").slice(0, 4),
            })
          }
          placeholder="4215"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        {value.postcode.length > 0 &&
        !isDeliverablePostcode(value.postcode) ? (
          <p className="mt-1 text-xs text-amber-700">
            Sorry, we only deliver to {DELIVERABLE_POSTCODES.join(", ")}.
          </p>
        ) : isDeliverablePostcode(value.postcode) ? (
          <p className="mt-1 text-xs text-emerald-700">✓ In our delivery zone</p>
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
