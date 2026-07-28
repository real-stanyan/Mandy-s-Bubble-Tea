// scripts/broadcast-app-download-grant-push.ts
// Tells existing app users that the app-download 20%-off grant is now sitting
// on their account (see scripts/backfill-app-download-grants.sql).
//
// Unlike broadcast-flash-promo-push.ts, this does NOT go to every device.
// A flash sale is true for everyone; "you have 20% off waiting" is only true
// for a phone holding an UNREDEEMED grant. Telling someone who already spent
// theirs — or who never got one — that a discount is waiting is a promise the
// checkout would break. So targeting is: device token -> profile -> a grant
// with redeemed_at IS NULL.
//
// Dry-run by default (prints recipient count + the exact payload); --apply sends.
// Rows are paged in 1000-row chunks — PostgREST silently caps a bare select.
// Run: set -a; source .env.production; set +a; npx tsx scripts/broadcast-app-download-grant-push.ts [--apply]
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
  title: "🎁 You've got 20% off waiting",
  body: "Thanks for having the app — your next order is 20% off. No code needed, it comes off automatically at checkout 🧋",
  data: { type: "app-download-promo", url: "/menu" },
};

const supabase = createClient(url, serviceKey);

async function page<T>(
  table: string,
  select: string,
  orderCol: string,
): Promise<T[]> {
  const rows: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} page ${from}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const [devices, profiles, grants] = await Promise.all([
    page<{ user_id: string; token: string }>(
      "device_push_tokens",
      "user_id,token",
      "id",
    ),
    page<{ user_id: string; phone_e164: string | null }>(
      "user_profiles",
      "user_id,phone_e164",
      "user_id",
    ),
    page<{ phone_e164: string; redeemed_at: string | null }>(
      "app_download_grants",
      "phone_e164,redeemed_at",
      "phone_e164",
    ),
  ]);

  const unredeemed = new Set(
    grants.filter((g) => g.redeemed_at == null).map((g) => g.phone_e164),
  );
  const phoneOf = new Map(profiles.map((p) => [p.user_id, p.phone_e164]));

  const tokens = new Set<string>();
  let noProfile = 0;
  let notEligible = 0;
  for (const d of devices) {
    const phone = phoneOf.get(d.user_id);
    if (!phone) {
      noProfile++;
      continue;
    }
    if (!unredeemed.has(phone)) {
      notEligible++;
      continue;
    }
    tokens.add(d.token);
  }

  const valid = [...tokens].filter((t) => Expo.isExpoPushToken(t));
  console.log(
    [
      `devices registered:      ${devices.length}`,
      `  skipped, no profile:   ${noProfile}`,
      `  skipped, no/spent grant: ${notEligible}`,
      `unique tokens targeted:  ${tokens.size} (${valid.length} valid Expo tokens)`,
      "",
      `payload: ${JSON.stringify(PAYLOAD, null, 2)}`,
    ].join("\n"),
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
