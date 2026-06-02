"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { OrderComplaintFormDialog } from "./OrderComplaintFormDialog";

type Status =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "eligible" }
  | { kind: "window_closed" }
  | { kind: "already_reported"; at: string };

type Props = {
  orderId: string;
  pickupNumber: string;
  orderState: string | null;
  orderCustomerId: string | null;
};

export function OrderComplaintSection({
  orderId,
  pickupNumber,
  orderState,
  orderCustomerId,
}: Props) {
  const { profile } = useAuth();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Cheap client-side gate: hide entirely if not the owner / not completed.
  const visible =
    profile?.square_customer_id != null &&
    profile.square_customer_id === orderCustomerId &&
    orderState === "COMPLETED";

  useEffect(() => {
    if (!visible) {
      setStatus({ kind: "hidden" });
      return;
    }
    let cancelled = false;
    setStatus({ kind: "loading" });
    fetch(`/api/orders/${orderId}/complaint-status`, {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setStatus({ kind: "hidden" });
          return;
        }
        const json = await res.json();
        if (json.reason === "eligible") setStatus({ kind: "eligible" });
        else if (json.reason === "window_closed") setStatus({ kind: "window_closed" });
        else if (json.reason === "already_reported") {
          setStatus({ kind: "already_reported", at: json.alreadyReportedAt });
        } else setStatus({ kind: "hidden" });
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "hidden" });
      });
    return () => {
      cancelled = true;
    };
  }, [visible, orderId]);

  if (!visible || status.kind === "hidden") return null;

  if (status.kind === "loading") {
    return (
      <section className="mt-6 rounded-card border border-line bg-paper p-4">
        <p className="text-sm text-ink3">Checking…</p>
      </section>
    );
  }

  return (
    <>
      <section className="mt-6 rounded-card border border-line bg-paper p-4">
        <h3 className="font-serif text-base text-ink">Need help with this order?</h3>
        <p className="mt-1 text-sm text-ink2">Tell us what went wrong.</p>
        <div className="mt-3">
          {status.kind === "eligible" && (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="rounded-tile border border-brand px-4 py-2 text-sm font-medium text-brand transition active:opacity-80"
            >
              Report a problem
            </button>
          )}
          {status.kind === "window_closed" && (
            <button
              type="button"
              disabled
              className="rounded-tile border border-line bg-line/40 px-4 py-2 text-sm text-ink3"
            >
              Complaint window closed
            </button>
          )}
          {status.kind === "already_reported" && (
            <button
              type="button"
              disabled
              className="rounded-tile border border-line bg-line/40 px-4 py-2 text-sm text-ink3"
            >
              Reported on {formatReportedDate(status.at)}
            </button>
          )}
        </div>
        {toast && (
          <p className="mt-3 rounded-tile bg-green-50 px-3 py-2 text-sm text-green-800">
            {toast}
          </p>
        )}
      </section>

      <OrderComplaintFormDialog
        orderId={orderId}
        pickupNumber={pickupNumber}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => {
          setStatus({ kind: "already_reported", at: new Date().toISOString() });
          setToast("Thanks — we'll be in touch within 24 hours.");
        }}
      />
    </>
  );
}

function formatReportedDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
