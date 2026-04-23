"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ChevronRight } from "lucide-react";

type MemberQrCardProps = {
  customerId: string;
  phoneE164: string;
};

export function MemberQrCard({ customerId, phoneE164 }: MemberQrCardProps) {
  const [open, setOpen] = useState(false);
  if (!customerId || !phoneE164) return null;

  const memberId = `M-${customerId.slice(-8).toUpperCase()}`;

  return (
    <>
      <div className="px-4 mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3.5 rounded-card border border-line bg-paper p-4 text-left transition active:opacity-90"
          aria-label="Expand member QR"
        >
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-line bg-white p-1.5">
            <QRCodeSVG value={phoneE164} size={84} level="M" />
          </div>
          <div className="min-w-0 flex-1">
            <span
              className="block font-mono uppercase text-brand"
              style={{
                fontSize: 10.5,
                letterSpacing: 1.4,
                fontWeight: 700,
              }}
            >
              MEMBER QR
            </span>
            <span
              className="mt-1 block font-serif text-ink"
              style={{
                fontSize: 17,
                lineHeight: "20px",
                letterSpacing: -0.3,
                fontWeight: 500,
              }}
            >
              Scan at the counter
            </span>
            <span
              className="mt-1 block truncate font-mono text-ink3"
              style={{ fontSize: 11.5, fontWeight: 700 }}
            >
              {memberId}
            </span>
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5">
              <span
                className="text-cream"
                style={{ fontSize: 11.5, fontWeight: 600 }}
              >
                Expand
              </span>
              <ChevronRight size={10} className="text-cream" />
            </span>
          </div>
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex flex-col items-center gap-3 rounded-card bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <QRCodeSVG value={phoneE164} size={260} level="M" />
            <span
              className="font-mono text-ink"
              style={{ fontSize: 14, letterSpacing: 1.5, fontWeight: 700 }}
            >
              {memberId}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-full bg-ink px-5 py-2.5 text-cream transition active:opacity-80"
              style={{ fontSize: 13, fontWeight: 600 }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
