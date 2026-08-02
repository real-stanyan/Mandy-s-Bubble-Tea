// src/lib/print-jobs.ts
import "server-only";
import type { Order, OrderLineItem, OrderLineItemModifier } from "square";
import { getSupabaseAdmin } from "./supabase-server";
import { isUsableOrderTicketName } from "./sticker-number";
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
  //   - has ≥1 successfully-captured tender, or
  //   - state is COMPLETED (covers $0 loyalty redemptions that close
  //     the order without ever creating a tender).
  // Raw `totalCents` alone cannot gate this: a free-drink redemption
  // legitimately totals $0 and still needs a sticker.
  //
  // CARD tenders include FAILED/VOIDED entries when a charge was
  // attempted but didn't go through. Treating any tender presence as
  // "paid" caused stickers to print on declined-then-retried orders
  // (the failed tender on the original order ticked the gate, and the
  // retried order created a separate sticker on success — net result
  // two cups for one paid drink). Only CAPTURED card tenders count.
  const tenders = order.tenders ?? [];
  const totalCents = order.totalMoney?.amount ?? 0n;
  const isCompleted = order.state === "COMPLETED";
  const hasSettledTender = tenders.some((t) =>
    t.type === "CARD" ? t.cardDetails?.status === "CAPTURED" : true,
  );
  if (!assumeSettled && !hasSettledTender && !isCompleted) {
    return { queued: false, reason: "not_paid" };
  }
  const lineItems = order.lineItems ?? [];
  if (lineItems.length === 0) {
    return { queued: false, reason: "no_line_items" };
  }

  // Three channels, not two. metadata.source is "web" | "app" (set from
  // clientPlatformFrom on every order we create); an order carrying neither
  // never went through our API at all, which means the in-store POS.
  //
  // This used to fold "app" into "pos" — the column predates the app — so an
  // app order was indistinguishable from a walk-in at the counter: channel
  // analysis was impossible (#87) and the admin prints table, which keys its
  // "线上" highlight off this value, didn't flag app orders as online.
  const source: "web" | "app" | "pos" =
    order.metadata?.source === "web"
      ? "web"
      : order.metadata?.source === "app"
        ? "app"
        : "pos";

  // Sticker number.
  //
  // Priority: order.ticketName (set by us for web orders as "OL…" and by
  // Square POS Register as the customer-facing ticket number like "44"
  // when "Assign ticket numbers" is enabled). This is what prints on the
  // customer's receipt / ticket dispenser, so the cup sticker matches.
  //
  // Exception: Square Register names the ticket after the attached
  // customer when a member is left attached to the order
  // ("auto-logged-in member") — either their PHONE NUMBER (2026-05-31
  // incident: a cup printed "+61451519606") or their NAME ("Mao Sasaki").
  // Neither belongs in the number slot: a phone leaks PII and staff can't
  // match it, and a name belongs in the "Hi, {name}" greeting (the cup
  // label's left column). isUsableOrderTicketName accepts only ticketNames
  // that carry a digit (real ticket / order numbers) and rejects both
  // shapes, falling through to the store counter for the printed number.
  //
  // Fallback: our own daily store counter (next_store_order_number,
  // resets daily Brisbane). Emitted as a plain number to match the look
  // of Square's own ticket numbers. Kicks in if a POS order arrives with
  // no usable ticketName (phone-like, Register auto-numbering turned off,
  // or a source we don't handle). Keeps us printing so staff isn't handed
  // a blank cup. Note: this is a separate sequence from Square's, so on a
  // rare fallback the number may coincide with a real Square ticket the
  // same day — acceptable since the fallback is extremely rare.
  let stickerNumber: string;
  const admin = getSupabaseAdmin();
  const usableTicketName =
    order.ticketName && isUsableOrderTicketName(order.ticketName) ? order.ticketName : null;
  if (usableTicketName) {
    stickerNumber = usableTicketName;
  } else if (source === "web") {
    return { queued: false, reason: "error", detail: "web order missing ticketName" };
  } else {
    const { data, error } = await admin.rpc("next_store_order_number");
    if (error) {
      return { queued: false, reason: "error", detail: `counter rpc failed: ${error.message}` };
    }
    stickerNumber = String(Number(data));
    const reason = order.ticketName
      ? `unusable ticketName "${order.ticketName}" (phone or customer name from attached member)`
      : "no ticketName";
    console.warn(
      `[print-jobs] POS order ${order.id} ${reason}; fell back to store counter (${stickerNumber}). Check Square Register "Assign ticket numbers" + attached-customer.`,
    );
  }

  // Expand lineItems into cups.
  const cups: CupRow[] = [];
  for (const line of lineItems) {
    const q = Number(line.quantity ?? "1");
    const cup = cupFromLineItem(line);
    for (let i = 0; i < q; i++) cups.push(cup);
  }

  // Dev guard: skip the prod-Supabase insert that would cause the store's
  // Mac mini printer-client to print a real Zebra sticker. We still return
  // `queued: true` with a real stickerNumber so the downstream cup-label
  // path runs (its own dev guard skips Supabase writes but keeps the
  // ~/Desktop PNG dump for visual inspection).
  if (process.env.NODE_ENV === "development") {
    console.log(`[print-jobs dev] skipped enqueue for order ${order.id} (sticker ${stickerNumber})`);
    return { queued: true, stickerNumber };
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
  // Pearl sends either 3 separate modifier entries OR a single entry
  // with quantity="3"; we collapse both shapes to "Pearls(3)" so the
  // sticker reads `Pearls(3)+Pudding` instead of
  // `Pearls+Pearls+Pearls+Pudding` (saves room under MAX_MOD_CHARS and
  // matches the receipt convention staff already reads).
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
    // Format: `Pearls(2)` when count > 1. Parenthesised count is what
    // the tea-making staff expects from the receipt convention.
    toppings.push(count > 1 ? `${name}(${count})` : name);
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
