"use client";

import { QRCodeSVG } from "qrcode.react";
import { BRAND } from "@/lib/constants";

type MemberQrCardProps = {
  customerId: string;
  phoneE164: string;
};

export function MemberQrCard({ customerId, phoneE164 }: MemberQrCardProps) {
  if (!customerId || !phoneE164) return null;

  const shortId = customerId.slice(-6).toUpperCase();

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5 text-center shadow-sm sm:p-8">
      <h2
        className="text-xs font-bold uppercase tracking-widest"
        style={{ color: BRAND.primaryColor }}
      >
        Member Card
      </h2>

      <div className="mx-auto mt-5 inline-block rounded-xl bg-white p-3 ring-1 ring-black/5">
        <QRCodeSVG value={phoneE164} size={160} level="M" />
      </div>

      <p className="mt-4 font-mono text-lg tracking-widest text-zinc-900">
        #{shortId}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Show at counter to earn stars
      </p>
    </section>
  );
}
