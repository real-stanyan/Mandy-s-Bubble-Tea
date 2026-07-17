// scripts/broadcast-flash-promo-sms.ts
// Sends the flash-promo SMS to every registered customer (user_profiles
// rows with a phone). Dry-run by default (prints recipient count, the exact
// message, and a cost estimate); --apply sends. --limit N caps recipients
// (use --limit 1 --apply for a self-test first).
//
// Uses Twilio's REST API directly via fetch — no SDK dependency.
// Sender: the account owns no phone numbers (Twilio here is Verify-only for
// OTP), so this sends from an ALPHANUMERIC sender ID — allowed in Australia
// without registration, but one-way: recipients cannot reply STOP. Spam Act
// 2003 compliance therefore rides on (a) recipients being registered
// customers (inferred consent), (b) the business being identified, and
// (c) a functional opt-out channel (the store phone) in the message.
//
// Run: set -a; source .env.local; set +a; \
//      npx tsx scripts/broadcast-flash-promo-sms.ts [--apply] [--limit N]
// (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN come from .env.local;
//  TWILIO_FROM defaults to the MandysTea alpha sender, override if needed)
import { createClient } from "@supabase/supabase-js";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
// Ledger of already-sent numbers — makes reruns resume instead of
// double-sending if the process dies mid-broadcast.
const LEDGER = "scripts/.flash-promo-sms-sent.log";
const limitIdx = process.argv.indexOf("--limit");
const LIMIT =
  limitIdx > -1 ? parseInt(process.argv[limitIdx + 1] ?? "", 10) : Infinity;
// --to +614xxxxxxxx: skip the DB list and send only to this number (self-test).
const toIdx = process.argv.indexOf("--to");
const TO_OVERRIDE = toIdx > -1 ? process.argv[toIdx + 1] : null;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = process.env.TWILIO_FROM ?? "MandysTea"; // alpha sender (11-char max) or E.164 number
if (!url || !serviceKey) {
  console.error("need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (APPLY && (!twilioSid || !twilioToken || !twilioFrom)) {
  console.error("need TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM to --apply");
  process.exit(1);
}

const MESSAGE =
  "Mandy's Bubble Tea: TODAY ONLY - 20% OFF your whole order! " +
  "Order now: mandybubbletea.com (Opt out: 0404 978 238)";

const AUD_PER_SMS = 0.0715; // Twilio AU outbound list price, check console

const supabase = createClient(url, serviceKey);

async function allPhones(): Promise<string[]> {
  const phones: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("phone_e164")
      .not("phone_e164", "is", null)
      .order("user_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`page ${from}: ${error.message}`);
    for (const row of data ?? []) {
      if (row.phone_e164?.startsWith("+")) phones.push(row.phone_e164);
    }
    if (!data || data.length < PAGE) break;
  }
  return [...new Set(phones)];
}

async function sendOne(to: string): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: twilioFrom!, Body: MESSAGE }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    sid?: string;
    message?: string;
  };
  return res.ok
    ? { ok: true, detail: json.sid ?? "sent" }
    : { ok: false, detail: json.message ?? `HTTP ${res.status}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const alreadySent = new Set(
    existsSync(LEDGER)
      ? readFileSync(LEDGER, "utf8").split("\n").filter(Boolean)
      : [],
  );
  const phones = (
    TO_OVERRIDE
      ? [TO_OVERRIDE]
      : (await allPhones()).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined)
  ).filter((p) => !alreadySent.has(p));
  if (alreadySent.size > 0) {
    console.log(`ledger: skipping ${alreadySent.size} already-sent numbers`);
  }
  console.log(
    `${phones.length} recipients` +
      `\nmessage (${MESSAGE.length} chars): ${MESSAGE}` +
      `\nestimated cost: ~A$${(phones.length * AUD_PER_SMS).toFixed(2)}`,
  );
  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to send.");
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const to of phones) {
    const r = await sendOne(to);
    if (r.ok) {
      sent++;
      appendFileSync(LEDGER, to + "\n");
    } else {
      failed++;
      console.warn(`FAILED ${to}: ${r.detail}`);
    }
    if ((sent + failed) % 25 === 0) {
      console.log(`progress: ${sent + failed}/${phones.length}`);
    }
    // Submission pacing only — Twilio's sender queue meters actual
    // delivery, and 2h+ of queue headroom covers this batch size.
    await sleep(500);
  }
  console.log(`done: ${sent} sent, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
