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
        className="modal-scrim-in absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
      />
      {/* card — the card itself does NOT scroll, the body inside it does.
          Close used to be absolutely positioned inside the scroll container,
          so it sat at the top of the CONTENT rather than the top of the card:
          any tall item (the live cup preview made every item tall) pushed it
          out of view and the customer had to scroll back up to dismiss.

          Height in dvh, not vh: mobile vh is computed against the LARGEST
          viewport (URL bar collapsed), so a bottom-anchored 92vh sheet stuck
          its top — and the close button on it — behind the browser bar
          whenever the bar was showing and the item was tall enough to hit
          the cap. dvh tracks the visible viewport as the bar comes and goes;
          the vh utility stays as the fallback for browsers without dvh. */}
      <div
        role="dialog"
        aria-modal="true"
        className="modal-card-in relative z-[1] flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[24px] bg-card shadow-[0_30px_80px_rgba(42,30,20,0.4)] supports-[height:100dvh]:max-h-[calc(100dvh-2.5rem)] sm:max-h-[90vh] sm:supports-[height:100dvh]:max-h-[90dvh]"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-4 top-4 z-20 grid h-9 w-9 place-items-center rounded-full bg-paper text-ink2 shadow-sm transition hover:bg-bg2"
        >
          <X size={18} />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ItemModalCloseContext.Provider value={close}>
            {children}
          </ItemModalCloseContext.Provider>
        </div>
      </div>
    </div>
  );
}
