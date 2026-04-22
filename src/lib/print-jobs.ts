// src/lib/print-jobs.ts
import "server-only";
import type { Order, OrderLineItem, OrderLineItemModifier } from "square";
import { getSupabaseAdmin } from "./supabase-server";
import { encodeStoreStickerNumber } from "./sticker-number";
import type { ModifierBucket } from "./modifier-buckets";

type CupRow = {
  drinkName: string;
  toppings: string[];
  ice: string | null;
  sugar: string | null;
  priceCents: number;
};

type EnqueueArgs = {
  order: Order;
};

export async function enqueuePrintJob({ order }: EnqueueArgs): Promise<
  | { queued: true; stickerNumber: string }
  | { queued: false; reason: "not_paid" | "no_line_items" | "conflict" | "error"; detail?: string }
> {
  // Gate: must be settled. "Settled" is either:
  //   - has ≥1 tender (a real payment was applied), or
  //   - state is COMPLETED (covers $0 loyalty redemptions that close
  //     the order without ever creating a tender).
  // Raw `totalCents` alone cannot gate this: a free-drink redemption
  // legitimately totals $0 and still needs a sticker.
  const tenders = order.tenders ?? [];
  const totalCents = order.totalMoney?.amount ?? 0n;
  const isCompleted = order.state === "COMPLETED";
  if (tenders.length === 0 && !isCompleted) {
    return { queued: false, reason: "not_paid" };
  }
  const lineItems = order.lineItems ?? [];
  if (lineItems.length === 0) {
    return { queued: false, reason: "no_line_items" };
  }

  const source: "web" | "pos" = order.metadata?.source === "web" ? "web" : "pos";

  // Sticker number.
  let stickerNumber: string;
  const admin = getSupabaseAdmin();
  if (source === "web") {
    if (!order.ticketName) {
      return { queued: false, reason: "error", detail: "web order missing ticketName" };
    }
    stickerNumber = order.ticketName;
  } else {
    const { data, error } = await admin.rpc("next_store_order_number");
    if (error) {
      return { queued: false, reason: "error", detail: `counter rpc failed: ${error.message}` };
    }
    stickerNumber = encodeStoreStickerNumber(Number(data));
  }

  // Expand lineItems into cups.
  const cups: CupRow[] = [];
  for (const line of lineItems) {
    const q = Number(line.quantity ?? "1");
    const cup = cupFromLineItem(line);
    for (let i = 0; i < q; i++) cups.push(cup);
  }

  const { error: insertError } = await admin.from("print_jobs").insert(
    {
      square_order_id: order.id!,
      source,
      sticker_number: stickerNumber,
      order_total_cents: Number(totalCents),
      cups,
      status: "pending",
    },
    { count: "exact" },
  );
  if (insertError) {
    // Unique-violation on square_order_id = already queued; silent skip.
    if (insertError.code === "23505") {
      return { queued: false, reason: "conflict" };
    }
    return { queued: false, reason: "error", detail: insertError.message };
  }
  return { queued: true, stickerNumber };
}

function cupFromLineItem(line: OrderLineItem): CupRow {
  const toppings: string[] = [];
  let ice: string | null = null;
  let sugar: string | null = null;

  // Square does NOT include the modifier list id on the line-item
  // modifier payload, so we classify by name. MODIFIER_LIST_BUCKETS +
  // bucketForModifierList() exist in modifier-buckets.ts for a future
  // catalog-lookup path that would resolve the list id; for the MVP
  // name matching is sufficient.
  for (const m of line.modifiers ?? []) {
    const bucket = matchModifierByName(m.name ?? "");
    placeInBucket(bucket, m, toppings, (v) => (ice = v), (v) => (sugar = v));
  }

  // Unit price = base variation price + sum of modifier upcharges.
  const basePrice = Number(line.basePriceMoney?.amount ?? 0n);
  const modPrice = (line.modifiers ?? []).reduce((s: number, m: OrderLineItemModifier) => {
    return s + Number(m.basePriceMoney?.amount ?? 0n);
  }, 0);
  const priceCents = basePrice + modPrice;

  return {
    drinkName: line.name ?? "Drink",
    toppings,
    ice,
    sugar,
    priceCents,
  };
}

function placeInBucket(
  bucket: ModifierBucket,
  m: OrderLineItemModifier,
  toppings: string[],
  setIce: (v: string) => void,
  setSugar: (v: string) => void,
): void {
  const name = m.name ?? "";
  if (bucket === "topping") toppings.push(name);
  else if (bucket === "ice") setIce(name);
  else if (bucket === "sugar") setSugar(name);
}

// Fallback: classify a modifier by its name if the modifier list id isn't
// available on the payload. Case-insensitive substring match against known
// patterns; anything else lands in "topping" as a safe default.
function matchModifierByName(name: string): ModifierBucket {
  const n = name.toLowerCase();
  if (n.includes("sugar")) return "sugar";
  if (n.includes("ice")) return "ice";
  return "topping";
}
