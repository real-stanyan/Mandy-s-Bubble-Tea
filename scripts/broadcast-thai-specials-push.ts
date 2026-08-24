// scripts/broadcast-thai-specials-push.ts
// Announces the 2026-08-24 Weekly Specials rotation — Honeydew Milk Tea and
// Blueberry Slushy come off the shelf, Thai Coco Frappe ($7.20→$5.60) and
// Thai Milk Tea ($6.20→$4.60) go on — to EVERY registered app device, same
// "true for everyone" targeting as broadcast-pineapple-orange-specials-push.ts
// (the shelf is visible to all /menu visitors regardless of account state).
//
// Originals were verified against the LIVE production Square catalog on
// 2026-08-24 (Thai Coco Frappe 720, Thai Milk Tea 620). VERIFY the specials
// prices (560 / 460) are live in Square before --apply — a push that quotes
// prices the menu doesn't show yet is a promise checkout won't keep.
//
// Dry-run by default (prints token count + the exact payload); --apply sends.
// Tokens are paged in 1000-row chunks (PostgREST silently caps a bare
// select), deduped, and pushed via expo-server-sdk's own chunking.
// Run: set -a; source .env.local; set +a; npx tsx scripts/broadcast-thai-specials-push.ts [--apply]
import { createClient } from "@supabase/supabase-js";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";

const APPLY = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const PAYLOAD = {
  title: "🥥 New Weekly Specials",
  body: "Thai Coco Frappe $5.60 (was $7.20) & Thai Milk Tea $4.60 (was $6.20) — this week's shelf is live.",
  data: { type: "weekly-special-promo", url: "/menu" },
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
    `${tokens.length} tokens (${valid.length} valid Expo tokens)\npayload: ${JSON.stringify(PAYLOAD, null, 2)}`,
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
          console.error("ticket error:", JSON.stringify(t));
        }
      }
    } catch (err) {
      errored += chunk.length;
      console.error("chunk failed:", err);
    }
  }
  console.log(`done: ${accepted} accepted, ${errored} errored`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
