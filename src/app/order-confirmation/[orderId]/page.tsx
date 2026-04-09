import Link from "next/link";
import { notFound } from "next/navigation";
import { squareClient } from "@/lib/square";
import { formatPrice } from "@/lib/utils";
import { BRAND, BUSINESS } from "@/lib/constants";

// Server-rendered confirmation page. Fetches the authoritative order
// from Square so we're displaying real pricing/state, not trusting
// client-side cart data that may already be cleared.

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ orderId: string }>;
};

export default async function OrderConfirmationPage({ params }: PageProps) {
  const { orderId } = await params;

  let order;
  try {
    const response = await squareClient.orders.get({ orderId });
    order = response.order;
  } catch {
    notFound();
  }

  if (!order) notFound();

  const pickup = order.fulfillments?.[0]?.pickupDetails;
  const totalCents = order.totalMoney?.amount ?? 0n;
  const taxCents = order.totalTaxMoney?.amount ?? 0n;
  const subtotalCents = totalCents - taxCents;

  return (
    <div className="flex flex-1 flex-col">
      <header
        className="w-full px-6 py-10 text-white"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2 text-center">
          <p className="text-sm uppercase tracking-wide opacity-80">
            Order placed
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Thanks, {pickup?.recipient?.displayName ?? "friend"}!
          </h1>
          <p className="text-sm opacity-90">
            We&apos;ll start making your drinks now.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <section className="mb-8 rounded-lg border border-black/10 bg-white p-6">
          <h2 className="mb-3 text-lg font-semibold text-zinc-900">
            Pickup details
          </h2>
          <p className="text-sm text-zinc-700">{BUSINESS.name}</p>
          <p className="text-sm text-zinc-600">{BUSINESS.address}</p>
          <p className="text-sm text-zinc-600">{BUSINESS.phone}</p>
          {pickup?.note && (
            <p className="mt-3 rounded bg-zinc-50 p-3 text-xs text-zinc-600">
              Note: {pickup.note}
            </p>
          )}
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-zinc-900">
            Your order
          </h2>
          <ul className="divide-y divide-black/10 rounded-lg border border-black/10 bg-white">
            {order.lineItems?.map((li, idx) => (
              <li
                key={li.uid ?? idx}
                className="flex items-start justify-between gap-3 p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-900">
                    {li.quantity}× {li.name ?? "Item"}
                  </p>
                  {li.variationName && (
                    <p className="text-xs text-zinc-500">{li.variationName}</p>
                  )}
                  {li.modifiers && li.modifiers.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {li.modifiers.map((m, i) => (
                        <li
                          key={m.uid ?? i}
                          className="truncate text-xs text-zinc-500"
                        >
                          + {m.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-sm font-semibold text-zinc-900">
                  {formatPrice(li.totalMoney?.amount ?? 0n)}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-4 space-y-1 text-sm">
            <Row label="Subtotal" value={formatPrice(subtotalCents)} />
            {taxCents > 0n && (
              <Row label="Tax" value={formatPrice(taxCents)} />
            )}
            <Row
              label="Total"
              value={formatPrice(totalCents)}
              emphasis
            />
          </div>
        </section>

        <div className="flex flex-col items-center gap-3">
          <p className="text-xs text-zinc-500">Order ID: {order.id}</p>
          <Link
            href="/menu"
            className="rounded-full px-5 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            Back to menu
          </Link>
        </div>
      </main>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between ${
        emphasis ? "border-t border-black/10 pt-2 text-base font-semibold" : ""
      }`}
    >
      <span className={emphasis ? "text-zinc-900" : "text-zinc-600"}>
        {label}
      </span>
      <span className="text-zinc-900">{value}</span>
    </div>
  );
}
