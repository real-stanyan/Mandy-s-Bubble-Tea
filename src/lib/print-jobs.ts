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
  /**
   * Skip the "is settled" gate. Set this only when the caller has
   * already confirmed the order is fully paid/closed but the order
   * object it holds hasn't caught up yet. Specifically: after a
   * successful `orders.pay({ paymentIds: [] })` for a $0 loyalty
   * redemption, Square returns the order still in state=OPEN with
   * zero tenders even though it's closed. The /api/payment route
   * knows it just succeeded, so it can bypass the gate.
   */
  assumeSettled?: boolean;
};

export async function enqueuePrintJob({ order, assumeSettled = false }: EnqueueArgs): Promise<
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
  if (!assumeSettled && tenders.length === 0 && !isCompleted) {
    return { queued: false, reason: "not_paid" };
  }
  const lineItems = order.lineItems ?? [];
  if (lineItems.length === 0) {
    return { queued: false, reason: "no_line_items" };
  }

  const source: "web" | "pos" = order.metadata?.source === "web" ? "web" : "pos";

  // Sticker number.
  //
  // Priority: order.ticketName (set by us for web orders as "OL…" and by
  // Square POS Register as the customer-facing ticket number like "44"
  // when "Assign ticket numbers" is enabled). This is what prints on the
  // customer's receipt / ticket dispenser, so the cup sticker matches.
  //
  // Fallback: our own TA-series counter. Kicks in only if a POS order
  // arrives with no ticketName (Register auto-numbering turned off,
  // or a source we don't handle). Keeps us printing so staff isn't
  // handed a blank cup.
  let stickerNumber: string;
  const admin = getSupabaseAdmin();
  if (order.ticketName) {
    stickerNumber = order.ticketName;
  } else if (source === "web") {
    return { queued: false, reason: "error", detail: "web order missing ticketName" };
  } else {
    const { data, error } = await admin.rpc("next_store_order_number");
    if (error) {
      return { queued: false, reason: "error", detail: `counter rpc failed: ${error.message}` };
    }
    stickerNumber = encodeStoreStickerNumber(Number(data));
    console.warn(
      `[print-jobs] POS order ${order.id} has no ticketName; fell back to TA counter (${stickerNumber}). Check Square Register "Assign ticket numbers" setting.`,
    );
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
  // Aggregate same-name toppings into a count. A customer who taps +3
  // Pearl sends 3 separate modifier entries to Square; we collapse them
  // to "Pearl x3" so the sticker reads `Pearl x3+Pudding` instead of
  // `Pearl+Pearl+Pearl+Pudding` (saves room under MAX_MOD_CHARS and is
  // faster for staff to read).
  const toppingCounts = new Map<string, number>();
  let ice: string | null = null;
  let sugar: string | null = null;
  let milk: string | null = null;

  // Square does NOT include the modifier list id on the line-item
  // modifier payload, so we classify by name. MODIFIER_LIST_BUCKETS +
  // bucketForModifierList() exist in modifier-buckets.ts for a future
  // catalog-lookup path that would resolve the list id; for the MVP
  // name matching is sufficient.
  for (const m of line.modifiers ?? []) {
    const name = m.name ?? "";
    const bucket = matchModifierByName(name);
    if (bucket === "topping") {
      // Square can either emit N separate modifier entries for "add N of X"
      // OR a single entry with quantity=N (observed in the wild). Respect
      // whichever representation the Orders API sent us so the topping
      // count on the sticker matches the receipt.
      const qty = Math.max(1, parseInt(m.quantity ?? "1", 10) || 1);
      toppingCounts.set(name, (toppingCounts.get(name) ?? 0) + qty);
    } else if (bucket === "ice") {
      ice = name;
    } else if (bucket === "sugar") {
      sugar = name;
    } else if (bucket === "milk") {
      // Standard(Recommended) is the default — skip from the sticker.
      // Non-default milk alternatives (Oat / Soy / Almond / Fresh) get
      // prepended to the toppings string so staff sees `Oat Milk+Pearls`.
      if (!isDefaultMilk(name)) milk = name;
    }
  }

  const toppings: string[] = [];
  if (milk) toppings.push(milk);
  for (const [name, count] of toppingCounts) {
    // Format: `Pearl x3` when count > 1. Lowercase `x` keeps the count
    // tight on the ZD411's condensed font and is ASCII-safe across
    // fonts. Space before `x` keeps name legibility when joined with
    // `+` separators: `Pearl x3+Oreo x2`.
    toppings.push(count > 1 ? `${name} x${count}` : name);
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

// Fallback: classify a modifier by its name if the modifier list id isn't
// available on the payload. Case-insensitive substring match against known
// patterns; anything else lands in "topping" as a safe default.
function matchModifierByName(name: string): ModifierBucket {
  const n = name.toLowerCase();
  if (n.includes("sugar")) return "sugar";
  // "Warm" is an option in the ICE modifier list even though its name
  // doesn't literally contain "ice". Match it explicitly so it doesn't
  // fall through to topping.
  if (n.includes("ice") || n.trim() === "warm") return "ice";
  // ALTERNATIVE MILK list: "Standard(Recommended)" plus "Fresh/Soy/Oat/
  // Almond Milk". "recommended" catches the default option which doesn't
  // contain the word "milk".
  if (n.includes("milk") || n.includes("recommended")) return "milk";
  return "topping";
}

function isDefaultMilk(name: string): boolean {
  return /\brecommended\b|^\s*standard\b/i.test(name);
}
