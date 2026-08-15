import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { squareClient, SQUARE_LOCATION_ID, findCustomerByPhone } from "@/lib/square";
import { findLoyaltyAccountByPhone } from "@/lib/loyalty";
import { normalizePhone } from "@/lib/auth-format";
import { isCustomAmountOnly } from "@/lib/orders/custom-amount";
import { getDeliveryPause } from "@/lib/store-status-server";
import { assessPaymentHealth } from "@/lib/alerts/payment-health";
import { getMenu } from "@/lib/catalog";
import { getLivePromotions, buildPromotionsDigest } from "@/lib/chat/promotions";
import { readLastCount } from "@/lib/staff/stock-history-store";
import { readThresholds } from "@/lib/staff/threshold-store";
import { applyThresholds, type ThresholdOverrides } from "@/lib/staff/stocklist";

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
//   Every action is reversible and tells Rick. Staff cannot review what an
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
      text: `${headline} By card brand — ${brands}. If the declines are almost all one brand, it is the bank or Square, not the shop: tell customers to use another card and let Rick know so he can raise it with Square.`,
    };
  } catch {
    return {
      text: "Could not reach Square to check payments. That is not the same as payments being broken — try again in a minute, and tell Rick if it keeps failing.",
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
    return { text: "Could not read the print queue just now. Tell Rick if this keeps happening." };
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
        text: `No order found for ${ref} in the last 24 hours. Check the number, or it may be from an earlier day — Rick can look further back.`,
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
      "Anything beyond this — changing the account, refunding an order, adding stars by hand — is Rick's.",
    );
    return { text: parts.join(" ") };
  } catch {
    return { text: "Could not reach Square to look that customer up." };
  }
}

/** Is the shop's own hardware alive? The question behind most "it's broken"
 *  reports, and the one nobody at the counter can answer: the Mac mini runs
 *  headless under the bench. */
export async function checkDevices(): Promise<ToolResult> {
  try {
    const { data } = await getSupabaseAdmin()
      .from("printer_heartbeats")
      .select("device_id,last_seen_at,printer_status,pending_count")
      .order("last_seen_at", { ascending: false })
      .limit(5);
    const rows = data ?? [];
    if (rows.length === 0) {
      return { text: "No printer machine has ever checked in. Tell Rick." };
    }
    const now = Date.now();
    const lines = rows.map((r) => {
      const seen = Date.parse(String(r.last_seen_at));
      const mins = Number.isFinite(seen) ? Math.round((now - seen) / 60000) : null;
      // A heartbeat is a promise to keep speaking. Silence is the signal, and
      // "last seen 40 minutes ago" is a different problem from "printer is
      // out of paper" — one needs the machine restarted, the other a roll.
      const alive = mins !== null && mins < 5;
      return `${r.device_id}: ${alive ? "running" : `LAST SEEN ${mins ?? "?"} min ago — probably not running`}, printer ${r.printer_status}, ${r.pending_count} jobs waiting`;
    });
    return { text: lines.join(". ") + "." };
  } catch {
    return { text: "Could not read the printer machines' status just now." };
  }
}

/** A drink: what it costs, what sizes, and whether Square has it sold out. */
export async function checkMenuItem(query: string): Promise<ToolResult> {
  const q = query.trim().toLowerCase();
  if (!q) return { text: "No drink name given." };
  try {
    const menu = await getMenu();
    const all = [...menu.itemsBySlug.values()].flat().concat(menu.uncategorizedItems);
    const seen = new Set<string>();
    const matches = all
      .filter((i) => {
        if (seen.has(i.id)) return false;
        seen.add(i.id);
        return i.name.toLowerCase().includes(q);
      })
      .slice(0, 5);
    if (matches.length === 0) {
      return { text: `Nothing on the menu matches "${query}".` };
    }
    const lines = matches.map((i) => {
      const prices = i.variations
        .map((v) => `${v.name ?? "one size"} $${((Number(v.priceCents ?? 0n)) / 100).toFixed(2)}`)
        .join(", ");
      return `${i.name}${i.soldOut ? " — SOLD OUT" : ""}: ${prices || "no price set"}`;
    });
    return { text: lines.join(". ") + "." };
  } catch {
    return { text: "Could not read the menu just now." };
  }
}

/** What deals are actually running, so nobody invents one at the counter. */
export async function checkPromotions(): Promise<ToolResult> {
  try {
    // No customer: this is the shop-wide list, not anybody's star balance.
    const promotions = await getLivePromotions(null);
    if (promotions.length === 0) {
      return { text: "No promotions are running right now." };
    }
    return {
      text:
        buildPromotionsDigest(promotions) +
        "\n\nThese are the only deals. If a customer insists on one that is not here, do not honour it — get Rick.",
    };
  } catch {
    return { text: "Could not read the promotions just now." };
  }
}

/** The last stock count, and what it said was running low. */
export async function checkStock(): Promise<ToolResult> {
  try {
    const [snapshot, overrides] = await Promise.all([
      readLastCount(),
      readThresholds().catch(() => ({}) as ThresholdOverrides),
    ]);
    if (!snapshot) return { text: "No stock count has been submitted yet." };
    const categories = applyThresholds(overrides);
    const low: string[] = [];
    for (const cat of categories) {
      for (const item of cat.items) {
        const raw = snapshot.counts[item.id];
        if (raw === undefined || raw === "") continue;
        if (item.rule.kind === "threshold" && Number(raw) <= item.rule.value) {
          low.push(`${item.name} (${raw})`);
        }
        if (item.rule.kind === "sufficiency" && (raw === "short" || raw === "maybe")) {
          low.push(`${item.name} (${raw === "short" ? "not enough" : "maybe enough"})`);
        }
      }
    }
    return {
      text:
        `Last stock count was ${snapshot.date}. ` +
        (low.length === 0
          ? "Nothing was flagged as low."
          : `Flagged low: ${low.join(", ")}.`),
    };
  } catch {
    return { text: "Could not read the last stock count just now." };
  }
}

/** How the day is going: orders and takings so far. */
export async function checkToday(includeTakings: boolean): Promise<ToolResult> {
  try {
    // Brisbane midnight, not UTC: "today" to the person asking is the shop's
    // day, and for most of the trading day the two disagree.
    const now = new Date();
    const brisbane = new Date(now.getTime() + 10 * 60 * 60 * 1000);
    const midnightUtc = new Date(
      Date.UTC(brisbane.getUTCFullYear(), brisbane.getUTCMonth(), brisbane.getUTCDate()) -
        10 * 60 * 60 * 1000,
    );
    const res = await squareClient.payments.list({
      beginTime: midnightUtc.toISOString(),
      sortOrder: "DESC",
      limit: 200,
    });
    const payments = (res.data ?? []).filter((p) => p.status === "COMPLETED");
    if (payments.length === 0) {
      return { text: "No completed payments yet today." };
    }
    // How busy it has been is useful at the counter; what the shop took is
    // not, and the passcode is shared. So the money is composed in only for
    // the owner, rather than being written and then hopefully left unsaid —
    // a number that never reaches the model cannot be repeated by it.
    if (!includeTakings) {
      return {
        text: `${payments.length} paid orders today, since midnight Brisbane time. You do not have the takings — that is Rick's to look at.`,
      };
    }
    const cents = payments.reduce((sum, p) => sum + Number(p.amountMoney?.amount ?? 0n), 0);
    return {
      text: `${payments.length} paid orders today, $${(cents / 100).toFixed(2)} taken. This counts card and any other Square payment since midnight Brisbane time.`,
    };
  } catch {
    return { text: "Could not reach Square for today's orders." };
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
