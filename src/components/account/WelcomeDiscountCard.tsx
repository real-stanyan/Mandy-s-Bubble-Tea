"use client";

import Link from "next/link";
import { BRAND } from "@/lib/constants";

type Props = {
  percentage: number;
};

export function WelcomeDiscountCard({ percentage }: Props) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-black/10 bg-white p-5 shadow-sm sm:p-8"
      aria-label="Welcome discount"
    >
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full opacity-[0.08]"
        style={{ backgroundColor: BRAND.primaryColor }}
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: BRAND.primaryColor }}
          >
            Welcome Gift
          </p>
          <h3 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">
            {percentage}% OFF
          </h3>
          <p className="mt-1 text-sm text-zinc-600">
            Your first order — auto-applied at checkout.
          </p>
        </div>
        <Link
          href="/menu"
          className="self-start rounded-full px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 sm:self-auto"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          View Menu →
        </Link>
      </div>
    </section>
  );
}
