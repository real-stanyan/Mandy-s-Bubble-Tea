import { OrderRow, type OrderHistoryItem } from "./OrderRow";

type OrderHistoryProps = {
  orders: OrderHistoryItem[];
  title: string;
  hideIfEmpty?: boolean;
  onSeeAll?: () => void;
};

export function OrderHistory({
  orders,
  title,
  hideIfEmpty,
  onSeeAll,
}: OrderHistoryProps) {
  if (hideIfEmpty && orders.length === 0) return null;

  return (
    <section className="px-4 mt-5">
      <div className="flex items-center justify-between">
        <h2
          className="font-serif text-ink"
          style={{ fontSize: 17, letterSpacing: -0.3, fontWeight: 500 }}
        >
          {title}
        </h2>
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="text-brand transition active:opacity-70"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            See all →
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {orders.length === 0 ? (
          <p className="text-ink3" style={{ fontSize: 13 }}>
            No orders yet.
          </p>
        ) : (
          orders.map((order) => <OrderRow key={order.id} order={order} />)
        )}
      </div>
    </section>
  );
}
