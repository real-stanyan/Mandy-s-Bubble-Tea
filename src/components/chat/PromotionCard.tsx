"use client";

import Link from "next/link";
import { useChat } from "@/store/chat";

export type ApiPromotion = {
  key: string;
  title: string;
  detail: string;
  href: string | null;
  cta: string | null;
};

/** A promotion Mandy pointed at. Every word here is server-authored — the
 *  model only chose which promotion to show, never what it says or what it
 *  is worth. Styled as a poster face (pinned day ink on cream) because it
 *  keeps its light background in Evening Mode, same as the other cards. */
export function PromotionCard({ promotion }: { promotion: ApiPromotion }) {
  const close = useChat((s) => s.close);

  return (
    <div className="rounded-card border border-line bg-cream p-3 shadow-card">
      <p className="text-sm font-bold text-[#2A1E14]">{promotion.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[#5A4330]">{promotion.detail}</p>
      {promotion.href && promotion.cta ? (
        <Link
          href={promotion.href}
          onClick={close}
          className="mt-3 block rounded-full bg-brand px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99]"
        >
          {promotion.cta}
        </Link>
      ) : null}
    </div>
  );
}
