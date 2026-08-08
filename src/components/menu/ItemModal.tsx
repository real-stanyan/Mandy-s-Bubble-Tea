"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { ItemModalCloseContext } from "@/components/menu/ItemModalContext";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

// Client dialog shell for the intercepted item route. Renders a backdrop +
// centered card; dismissing (backdrop click, close button, Escape) pops the
// intercepted route via router.back() so the underlying menu/home is restored.
// The card body (image + info + order form) is a server component passed in.
export function ItemModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Held for as long as the modal is mounted. This one is an intercepted
  // route, so it unmounts on router.back() — out of band from whatever else
  // opened after it, which is precisely the ordering the old private
  // save/restore could not survive.
  useBodyScrollLock(true);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
      />
      {/* card */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-[1] max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-[24px] bg-card shadow-[0_30px_80px_rgba(42,30,20,0.4)] sm:max-h-[90vh] sm:rounded-card"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-paper text-ink2 shadow-sm transition hover:bg-bg2"
        >
          <X size={18} />
        </button>
        <ItemModalCloseContext.Provider value={close}>
          {children}
        </ItemModalCloseContext.Provider>
      </div>
    </div>
  );
}
