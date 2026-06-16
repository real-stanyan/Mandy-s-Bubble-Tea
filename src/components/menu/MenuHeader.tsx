"use client";

import { useEffect, useState } from "react";
import { getStoreStatus, type StoreStatus } from "@/lib/store-status";

export function MenuHeader() {
  const [status, setStatus] = useState<StoreStatus>(() =>
    getStoreStatus(new Date()),
  );

  useEffect(() => {
    const id = setInterval(() => setStatus(getStoreStatus(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);

  const label = status.open
    ? `Open · closes ${status.nextLabel.replace(/^until\s+/, "")}`
    : `Closed · opens ${status.nextLabel}`;

  return (
    <div className="px-4 pt-2.5 pb-1">
      <p
        className="font-mono uppercase text-brand"
        style={{ fontSize: 10.5, letterSpacing: 1.3, fontWeight: 700 }}
      >
        MANDY&apos;S · SOUTHPORT
      </p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <h1
          className="font-serif text-ink shrink-0"
          style={{ fontSize: 44, lineHeight: "46px", letterSpacing: -1.2, fontWeight: 600 }}
        >
          The Menu
        </h1>
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 " +
            (status.open ? "bg-green/12" : "bg-ink/8")
          }
          style={{
            backgroundColor: status.open
              ? "rgba(60,169,110,0.12)"
              : "rgba(42,30,20,0.08)",
          }}
        >
          <span
            className="inline-block rounded-full"
            style={{
              width: 7,
              height: 7,
              backgroundColor: status.open ? "#3CA96E" : "rgba(42,30,20,0.28)",
            }}
          />
          <span
            className={status.open ? "text-green-dark" : "text-ink2"}
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {label}
          </span>
        </span>
      </div>
    </div>
  );
}
