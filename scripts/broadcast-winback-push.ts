// scripts/broadcast-winback-push.ts
//
// Win-back for regulars who stopped coming. Analysis on 2026-08-12 over 90
// days of Square orders found 196 customers with 3+ orders who had not
// been back in 30 days. They averaged $10.50 a visit and 5.7 visits each —
// $11,359 of past spend that simply stopped.
//
// Deliberately NOT segmented by device token: push tokens are per-device
// and cannot be matched to a Square customer id without a mapping we do
// not have. So this reaches everyone with the app, and the copy is written
// to be worth reading whether or not you are lapsed — an "we miss you"
// message shown to a regular who came in yesterday reads as spam.
//
// Dry-run by default. --apply sends.
// Run: set -a; source .env.local; set +a; npx tsx scripts/broadcast-winback-push.ts [--apply]
import { createClient } from "@supabase/supabase-js";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";

const APPLY = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Brown Sugar Milk Tea is the single most-missed drink among the lapsed
// cohort (37 of 196 had it as their most-ordered) and the shop's overall
// #1 by revenue, so it carries the message without needing a discount.
// No percentage here on purpose: a free-drink reminder costs nothing and
// the loyalty balance is real, where a blanket discount trains people to
// wait for one.
const PAYLOAD = {
  title: "🧋 你的星星还在等你",
  body: "好久不见！你的会员星星没有过期，回来喝一杯，说不定就够换免费的了。",
  data: { type: "winback", url: "/menu" },
};

const supabase = createClient(url, serviceKey);

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
  const tokens = await allTokens();
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  console.log(
    `${tokens.length} tokens (${valid.length} valid)\npayload: ${JSON.stringify(PAYLOAD, null, 2)}`,
  );
  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to send.");
    return;
  }

  const expo = new Expo();
  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    sound: "default",
    title: PAYLOAD.title,
    body: PAYLOAD.body,
    data: PAYLOAD.data,
  }));

  let accepted = 0;
  let errored = 0;
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      for (const t of tickets) {
        if (t.status === "ok") accepted++;
        else {
          errored++;
          console.warn("ticket error:", t.message, t.details ?? "");
        }
      }
    } catch (err) {
      errored += chunk.length;
      console.error("chunk send failed:", err);
    }
  }
  console.log(`done: ${accepted} accepted, ${errored} errored`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
