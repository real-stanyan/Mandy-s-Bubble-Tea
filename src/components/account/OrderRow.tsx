import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatPrice } from "@/lib/utils";

export type OrderHistoryItem = {
  id: string;
  createdAt: string | null;
  state: string | null;
  fulfillmentState: string | null;
  fulfillmentType?: string | null;
  totalCents: string;
  itemSummary: string;
  lineCount: number;
  // Also returned by /api/orders/history (used by the redesigned OrdersView):
  referenceId?: string | null; // pickup / ticket number
  firstItemName?: string | null;
  firstItemImageUrl?: string | null;
  // Server-computed "in progress" flag: OPEN + placed today (Brisbane) + not
  // yet fulfilled (delivery delivered / pickup COMPLETED). The Square order
  // state stays OPEN indefinitely for self-delivery + uncompleted pickups, so
  // the list/badges can't key off state alone. Optional for older callers.
  active?: boolean;
};

export function OrderRow({ order }: { order: OrderHistoryItem }) {
  const stateKey = effectiveState(order.state, order.fulfillmentState);
  const badge = STATE_STYLES[stateKey];
  const isDelivery = order.fulfillmentType === "DELIVERY";

  return (
    <Link
      href={`/order-confirmation/${order.id}`}
      className="flex items-center justify-between gap-3 rounded-card border border-line bg-paper p-4 transition active:opacity-90"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="uppercase tracking-wide text-ink3"
            style={{ fontSize: 12 }}
          >
            {formatDate(order.createdAt)}
          </span>
          {badge && (
            <span
              className={
                "rounded-full border px-2 py-0.5 uppercase " + badge.className
              }
              style={{ fontSize: 10, letterSpacing: 0.5, fontWeight: 600 }}
            >
              {badge.label}
            </span>
          )}
          {isDelivery && (
            <span
              className="rounded-full border border-line px-2 py-0.5 uppercase text-[#C43A10]"
              style={{ fontSize: 10, letterSpacing: 0.5, fontWeight: 600 }}
            >
              🚚 Delivery
            </span>
          )}
        </div>
        <h3
          className="mt-1 truncate font-serif text-ink"
          style={{ fontSize: 15, letterSpacing: -0.2, fontWeight: 500 }}
        >
          {order.itemSummary ||
            `${order.lineCount} item${order.lineCount !== 1 ? "s" : ""}`}
        </h3>
        <p className="mt-0.5 text-ink3" style={{ fontSize: 12 }}>
          {order.lineCount} item{order.lineCount !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className="font-mono text-ink"
          style={{ fontSize: 14, fontWeight: 700 }}
        >
          {formatPrice(BigInt(order.totalCents))}
        </span>
        <ChevronRight size={16} className="text-ink3" />
      </div>
    </Link>
  );
}

function effectiveState(
  state: string | null,
  fulfillmentState: string | null,
): string {
  if (state === "OPEN" && fulfillmentState === "PREPARED") return "READY";
  return state ?? "";
}

const STATE_STYLES: Record<string, { label: string; className: string }> = {
  OPEN: {
    label: "In Progress",
    className: "bg-peach/20 text-ink2 border-peach/40",
  },
  READY: {
    label: "Ready",
    className: "bg-green/10 text-green-dark border-green/30",
  },
  COMPLETED: {
    label: "Completed",
    className: "bg-line text-ink3 border-line",
  },
  CANCELED: {
    label: "Cancelled",
    className: "bg-red-50 text-red-700 border-red-200",
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
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
