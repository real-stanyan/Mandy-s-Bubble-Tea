import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { squareClient, SQUARE_LOCATION_ID, findCustomerByPhone } from "@/lib/square";
import { findLoyaltyAccountByPhone } from "@/lib/loyalty";
import { normalizePhone } from "@/lib/auth-format";
import { isCustomAmountOnly } from "@/lib/orders/custom-amount";
import { getDeliveryPause } from "@/lib/store-status-server";
import { assessPaymentHealth } from "@/lib/alerts/payment-health";

// What the staff assistant is allowed to look at, and the very short list of
// things it is allowed to change.
//
// The split is deliberate and is the whole safety story. Looking costs
// nothing and is where almost all the value is: on 15 August the right answer
// to "payments keep failing" was a diagnosis — Mastercard, the acquirer's
// side, tell customers to use another card — and any code change would have
// been wrong. Acting is where a confident wrong answer costs money, so it is
// an explicit list rather than a capability.
//
// Two rules hold for everything below:
//
//   The model never writes a fact. It picks a tool; the server reads the
//   real system and composes the sentence. This is the same contract the
//   customer chatbot runs on, and it exists because a model that can
//   paraphrase a number will eventually invent one.
//
//   Every action is reversible and tells Stan. Staff cannot review what an
//   agent did, so the safety net is that nothing is one-way and nobody finds
//   out later by accident.

export type ToolResult = {
  /** Server-authored text. Goes to the model as the tool result and is the
   *  only thing it may repeat back. */
  text: string;
  /** True when this changed something, so the route knows to notify. */
  mutated?: boolean;
};

/* ------------------------------ diagnosis ------------------------------ */

/** How card payments have actually been going. The question staff cannot
 *  answer from the counter: is it this customer's card, or everyone's? */
export async function checkPayments(minutes = 30): Promise<ToolResult> {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  try {
    const res = await squareClient.payments.list({
      beginTime: since,
      sortOrder: "DESC",
      limit: 100,
    });
    const payments = res.data ?? [];
    const verdict = assessPaymentHealth(
      payments.map((p) => ({ failed: p.status === "FAILED" })),
    );
    if (verdict.attempts === 0) {
      return { text: `No card payments at all in the last ${minutes} minutes.` };
    }
    // Brand breakdown, because "is it one card brand" is the question that
    // separates "the bank's problem" from "ours", and it is not obvious from
    // the counter.
    const byBrand = new Map<string, { n: number; f: number }>();
    for (const p of payments) {
      const brand = p.cardDetails?.card?.cardBrand ?? "UNKNOWN";
      const e = byBrand.get(brand) ?? { n: 0, f: 0 };
      e.n += 1;
      if (p.status === "FAILED") e.f += 1;
      byBrand.set(brand, e);
    }
    const brands = [...byBrand.entries()]
      .map(([b, v]) => `${b}: ${v.f}/${v.n} declined`)
      .join("; ");
    const pct = (verdict.rate * 100).toFixed(0);
    const headline = verdict.alarming
      ? `PAYMENTS ARE FAILING: ${verdict.failures} of ${verdict.attempts} declined (${pct}%) in the last ${minutes} minutes.`
      : `Payments look normal: ${verdict.failures} of ${verdict.attempts} declined (${pct}%) in the last ${minutes} minutes.`;
    return {
      text: `${headline} By card brand — ${brands}. If the declines are almost all one brand, it is the bank or Square, not the shop: tell customers to use another card and let Stan know so he can raise it with Square.`,
    };
  } catch {
    return {
      text: "Could not reach Square to check payments. That is not the same as payments being broken — try again in a minute, and tell Stan if it keeps failing.",
    };
  }
}

/** Anything stuck in the label/receipt print queue. */
export async function checkPrinting(): Promise<ToolResult> {
  try {
    const admin = getSupabaseAdmin();
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const [jobs, cups] = await Promise.all([
      admin
        .from("print_jobs")
        .select("id,status,sticker_number,last_error,created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("cup_label_jobs")
        .select("id,status,sticker_number,last_error,created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const rows = [...(jobs.data ?? []), ...(cups.data ?? [])];
    if (rows.length === 0) {
      return { text: "Nothing has been sent to the printer in the last 2 hours." };
    }
    const failed = rows.filter((r) => r.status === "failed");
    const pending = rows.filter((r) => r.status === "pending");
    const parts = [
      `${rows.length} print jobs in the last 2 hours: ${failed.length} failed, ${pending.length} still waiting.`,
    ];
    if (failed.length > 0) {
      const first = failed[0] as { sticker_number?: string; last_error?: string };
      parts.push(
        `Most recent failure: ${first.sticker_number ?? "?"} — ${first.last_error ?? "no reason recorded"}.`,
      );
    }
    if (pending.length > 3) {
      parts.push(
        "A pile of waiting jobs usually means the printer is off, out of paper, or the Mac mini's printer app is not running.",
      );
    }
    return { text: parts.join(" ") };
  } catch {
    return { text: "Could not read the print queue just now. Tell Stan if this keeps happening." };
  }
}

/** Whether the shop is currently taking online orders and deliveries. */
export async function checkStoreStatus(): Promise<ToolResult> {
  const pause = await getDeliveryPause();
  if (pause) {
    return {
      text: `Delivery is PAUSED until ${pause.until} (reason recorded: ${pause.reason}). Pickup is unaffected. It lifts by itself at that time — nobody has to remember to turn it back on.`,
    };
  }
  return { text: "Delivery is on, and online ordering is running normally." };
}

/** One order, by its sticker number (OL846, DE837, or a POS number). */
export async function lookUpOrder(reference: string): Promise<ToolResult> {
  if (!SQUARE_LOCATION_ID) return { text: "Square location is not configured." };
  const ref = reference.trim().replace(/^#/, "");
  if (!ref) return { text: "No order number given." };
  try {
    // A full day, not "the last N orders": staff look things up hours after
    // the fact, and a busy hour is 20 orders on its own.
    const startAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await squareClient.orders.search({
      locationIds: [SQUARE_LOCATION_ID],
      limit: 500,
      query: {
        filter: { dateTimeFilter: { createdAt: { startAt } } },
        sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
      },
    });
    const hit = (res.orders ?? []).find(
      (o) =>
        o.referenceId?.toUpperCase() === ref.toUpperCase() ||
        o.ticketName?.toUpperCase() === ref.toUpperCase(),
    );
    if (!hit) {
      return {
        text: `No order found for ${ref} in the last 24 hours. Check the number, or it may be from an earlier day — Stan can look further back.`,
      };
    }
    const items = (hit.lineItems ?? [])
      .map((li) => `${li.quantity}× ${li.name ?? "custom amount"}`)
      .join(", ");
    const paid = (hit.netAmountDueMoney?.amount ?? 0n) === 0n;
    return {
      text: `${ref}: ${items || "no items"}. Placed ${hit.createdAt}. State ${hit.state}. ${paid ? "Paid." : "NOT paid — this one never completed checkout."}`,
    };
  } catch {
    return { text: "Could not reach Square to look that order up." };
  }
}

/** One customer, by the phone number they gave at the counter: whether they
 *  have an account, their stars, and what they have ordered recently.
 *
 *  This is the one tool that reads a real person's records rather than the
 *  shop's, so it is deliberately narrow. It answers the questions actually
 *  asked across a counter — is this the right person, did their order go
 *  through, how many stars have they got — and returns nothing else. No email
 *  address, no street address, no card details: none of that helps make a
 *  drink, and all of it is worth more to whoever might be standing there
 *  asking.
 *
 *  The lookup is by exact phone number, so it cannot be used to browse. */
export async function lookUpCustomer(phone: string): Promise<ToolResult> {
  const e164 = normalizePhone(phone.trim());
  if (!e164) {
    return { text: `"${phone}" is not a phone number I can look up.` };
  }
  if (!SQUARE_LOCATION_ID) return { text: "Square location is not configured." };

  try {
    const [customer, loyalty] = await Promise.all([
      findCustomerByPhone(e164),
      findLoyaltyAccountByPhone(e164).catch(() => null),
    ]);

    const parts: string[] = [];
    const name = [customer?.givenName, customer?.familyName].filter(Boolean).join(" ").trim();
    parts.push(
      customer
        ? `${name || "No name on file"} — account found for ${phone}.`
        : `No account for ${phone}. They may have ordered as a guest, which still works; it just means no stars.`,
    );
    if (loyalty) {
      parts.push(`${loyalty.balance} stars.`);
    } else if (customer) {
      parts.push("No stars yet.");
    }

    if (customer?.id) {
      const res = await squareClient.orders.search({
        locationIds: [SQUARE_LOCATION_ID],
        limit: 5,
        query: {
          filter: {
            customerFilter: { customerIds: [customer.id] },
            stateFilter: { states: ["OPEN", "COMPLETED", "CANCELED"] },
          },
          sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
        },
      });
      const orders = (res.orders ?? []).filter((o) => !isCustomAmountOnly(o));
      if (orders.length === 0) {
        parts.push("No orders on this account yet.");
      } else {
        parts.push(
          `Last ${orders.length} order${orders.length === 1 ? "" : "s"}: ` +
            orders
              .map((o) => {
                const items = (o.lineItems ?? [])
                  .map((li) => `${li.quantity}× ${li.name ?? "item"}`)
                  .join(", ");
                const ref = o.referenceId ?? o.ticketName ?? "no sticker";
                const paid = (o.netAmountDueMoney?.amount ?? 0n) === 0n;
                return `${ref} (${o.createdAt}, ${o.state}${paid ? ", paid" : ", NOT paid"}) ${items}`;
              })
              .join(" | "),
        );
      }
    }

    parts.push(
      "Anything beyond this — changing the account, refunding an order, adding stars by hand — is Stan's.",
    );
    return { text: parts.join(" ") };
  } catch {
    return { text: "Could not reach Square to look that customer up." };
  }
}

/* -------------------------------- actions ------------------------------- */

/** Pause delivery for a set number of hours. Self-expiring by design: the
 *  worst outcome of this action is that it lifts on its own. */
export async function pauseDelivery(hours: number, reason: string): Promise<ToolResult> {
  const capped = Math.min(Math.max(hours, 1), 12);
  const until = new Date(Date.now() + capped * 60 * 60 * 1000).toISOString();
  const clean = reason.trim() || "paused by staff";
  const { error } = await getSupabaseAdmin()
    .from("app_settings")
    .upsert(
      {
        key: "delivery_pause",
        value: { until, reason: clean },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  if (error) return { text: "Could not pause delivery — nothing changed." };
  return {
    text: `Delivery is paused for ${capped} hour${capped === 1 ? "" : "s"}, until ${until}. Customers see a maintenance message; pickup still works. It turns itself back on — you do not have to remember.`,
    mutated: true,
  };
}

/** Turn delivery back on before the pause would have expired. */
export async function resumeDelivery(): Promise<ToolResult> {
  const { error } = await getSupabaseAdmin()
    .from("app_settings")
    .delete()
    .eq("key", "delivery_pause");
  if (error) return { text: "Could not resume delivery — nothing changed." };
  return { text: "Delivery is back on.", mutated: true };
}

/** Re-queue a print job that failed, using the same clone-a-row approach the
 *  admin reprint button uses. */
export async function reprintOrder(stickerNumber: string): Promise<ToolResult> {
  const ref = stickerNumber.trim().replace(/^#/, "");
  if (!ref) return { text: "No sticker number given." };
  const admin = getSupabaseAdmin();
  const { data: orig } = await admin
    .from("print_jobs")
    .select("*")
    .eq("sticker_number", ref)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!orig) {
    return { text: `No print job found for ${ref}, so there is nothing to reprint.` };
  }
  const { error } = await admin.from("print_jobs").insert({
    square_order_id: `reprint:${orig.square_order_id}:${new Date().toISOString()}`,
    source: orig.source,
    sticker_number: orig.sticker_number,
    order_total_cents: orig.order_total_cents,
    cups: orig.cups,
    status: "pending",
  });
  if (error) return { text: `Could not re-queue ${ref} — nothing changed.` };
  return {
    text: `${ref} is back in the print queue. If it does not come out within a minute, the printer itself is the problem — check paper and power.`,
    mutated: true,
  };
}
