// scripts/broadcast-tasting-promo-push.ts
// Sends the tasting-promo announcement to EVERY registered app device.
//
// Same job as POST /api/promotions/tasting-promo/send, for when the HTTP route
// can't be reached: that route is gated on a Supabase admin *session cookie*,
// so it is only callable from a signed-in browser. This is the console path.
// Sibling of broadcast-flash-promo-push.ts.
//
// The money and the copy come from the tasting_promos row, never from flags —
// the push promises a price, and the only price that can be honoured is the one
// the pricing engine reads back out of that same row.
//
// Double-send is held off exactly as the route does it: a conditional update of
// pushed_at (null -> now()) that only one caller can win. --force re-announces
// a promo that was already stamped.
//
// Dry-run by default (prints the audience size and the exact payload).
// Run: set -a; source .env.local; set +a; npx tsx scripts/broadcast-tasting-promo-push.ts <promoKey> [--apply] [--force]
import { createClient } from "@supabase/supabase-js";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const promoKey = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (!promoKey) {
  console.error("usage: npx tsx scripts/broadcast-tasting-promo-push.ts <promoKey> [--apply] [--force]");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

/** Mirrors tastingPromoCopy() in src/lib/tasting-promo.ts. */
function buildCopy(row: {
  product_name: string;
  tasting_price_cents: number;
  ends_at: string;
}) {
  const days = Math.max(
    1,
    Math.ceil((new Date(row.ends_at).getTime() - Date.now()) / 86_400_000),
  );
  const price = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(row.tasting_price_cents / 100);
  return {
    title: `🧋 New Taste — ${row.product_name}`,
    body: `Try it for just ${price}! Exclusive for app users. Valid ${days} ${days === 1 ? "day" : "days"}. Tap to order.`,
  };
}

/** PostgREST silently caps a bare select — page explicitly. */
async function allTokens(): Promise<string[]> {
  const tokens: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("device_push_tokens")
      .select("token")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`page ${from}: ${error.message}`);
    for (const row of data ?? []) tokens.push(row.token);
    if (!data || data.length < PAGE) break;
  }
  return [...new Set(tokens)];
}

async function main() {
  const { data: row, error } = await supabase
    .from("tasting_promos")
    .select("key,product_name,tasting_price_cents,starts_at,ends_at,active,pushed_at")
    .eq("key", promoKey)
    .maybeSingle();
  if (error) throw new Error(`promo lookup: ${error.message}`);
  if (!row) throw new Error(`no tasting_promos row for "${promoKey}"`);

  const now = Date.now();
  if (!row.active || new Date(row.ends_at).getTime() <= now) {
    throw new Error("promo window is closed — nothing to announce");
  }
  if (row.pushed_at && !FORCE) {
    throw new Error(`already announced at ${row.pushed_at}; pass --force for a second wave`);
  }

  const copy = buildCopy(row);
  const payload = {
    ...copy,
    data: { type: "tasting-promo", url: "/menu", promoKey },
  };

  const tokens = await allTokens();
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  console.log(
    `promo: ${row.product_name} @ ${row.tasting_price_cents}c, ends ${row.ends_at}\n` +
      `${tokens.length} tokens (${valid.length} valid Expo tokens)\n` +
      `payload: ${JSON.stringify(payload, null, 2)}`,
  );
  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to send.");
    return;
  }
  if (valid.length === 0) {
    console.log("no valid tokens — nothing sent, pushed_at left alone.");
    return;
  }

  // Claim before sending, so a concurrent run cannot also push.
  if (!FORCE) {
    const { data: claimed, error: claimErr } = await supabase
      .from("tasting_promos")
      .update({ pushed_at: new Date().toISOString() })
      .eq("key", promoKey)
      .is("pushed_at", null)
      .select("key");
    if (claimErr) throw new Error(`claim: ${claimErr.message}`);
    if ((claimed ?? []).length === 0) {
      throw new Error("lost the claim — another send is already in flight");
    }
  }

  const expo = new Expo();
  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data,
    priority: "high",
  }));

  let accepted = 0;
  let errored = 0;
  const reasons = new Set<string>();
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      for (const t of tickets) {
        if (t.status === "ok") accepted++;
        else {
          errored++;
          if (t.message) reasons.add(t.message);
        }
      }
    } catch (err) {
      errored += chunk.length;
      reasons.add(err instanceof Error ? err.message : String(err));
    }
  }
  console.log(`\nsent: accepted=${accepted} errored=${errored}`);
  if (reasons.size > 0) console.log(`reasons: ${[...reasons].join(" | ")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
