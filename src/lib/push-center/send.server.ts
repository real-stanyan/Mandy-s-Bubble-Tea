import "server-only";
import { after } from "next/server";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { deleteDevicePushToken } from "@/lib/push-tokens";
import { renderCopy, type CampaignId, type CampaignSettings, type Copy } from "./campaigns";
import type { AudienceReport, Recipient } from "./audience.server";

// Push Center — send a run and keep a row per device.
//
// A ticket only says Expo accepted the message; whether APNs/FCM delivered
// it shows up in the receipt ten-odd seconds later. Both are written to
// push_run_recipients, success included, so "did the 9/14 specials push
// reach anyone?" is one query — the blind spot #384 describes.

const expo = new Expo();
const RECEIPT_DELAY_MS = 10_000;

export type SendResult = {
  runId: string;
  targeted: number;
  accepted: number;
  errored: number;
  errors: string[];
};

type RecipientRow = {
  run_id: string;
  campaign: string;
  user_id: string;
  customer_id: string | null;
  phone_e164: string | null;
  token: string;
  platform: string;
  ticket_id: string | null;
  ticket_error: string | null;
};

export async function sendRun(args: {
  campaign: CampaignId;
  copy: Copy;
  url: string;
  settings: CampaignSettings;
  audience: AudienceReport;
  createdBy: string;
}): Promise<SendResult> {
  const admin = getSupabaseAdmin();
  const { funnel, recipients } = args.audience;

  const { data: runRow, error: runErr } = await admin
    .from("push_runs")
    .insert({
      campaign: args.campaign,
      title: args.copy.title,
      body: args.copy.body,
      url: args.url,
      settings: args.settings,
      matched_count: funnel.matched,
      reachable_count: funnel.withApp,
      cooldown_count: funnel.cooldown,
      capped_count: funnel.capped + funnel.recentBuyers + funnel.holdout,
      targeted_count: recipients.length,
      created_by: args.createdBy,
    })
    .select("id")
    .single();
  if (runErr) throw new Error(`push_runs insert: ${runErr.message}`);
  const runId = (runRow as { id: string }).id;

  const messages: ExpoPushMessage[] = recipients.map((r) => {
    const { title, body } = renderCopy(args.copy, r.vars);
    return {
      to: r.token,
      sound: "default",
      title,
      body,
      priority: "high",
      data: { type: args.campaign, campaign: args.campaign, runId, url: args.url },
    };
  });

  const rows: RecipientRow[] = [];
  const errors: string[] = [];
  let accepted = 0;
  let errored = 0;
  const dead: string[] = [];

  let offset = 0;
  for (const chunk of expo.chunkPushNotifications(messages)) {
    const slice: Recipient[] = recipients.slice(offset, offset + chunk.length);
    offset += chunk.length;
    let tickets: ExpoPushTicket[] | null = null;
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!errors.includes(msg)) errors.push(msg);
    }
    slice.forEach((r, i) => {
      const t = tickets?.[i];
      const ok = t?.status === "ok";
      if (ok) accepted++;
      else errored++;
      let ticketError: string | null = null;
      if (t && t.status === "error") {
        ticketError = t.details?.error ?? t.message ?? "error";
        if (t.message && !errors.includes(t.message)) errors.push(t.message);
        if (t.details?.error === "DeviceNotRegistered") dead.push(r.token);
      } else if (!t) {
        ticketError = "send failed";
      }
      rows.push({
        run_id: runId,
        campaign: args.campaign,
        user_id: r.userId,
        customer_id: r.customerId,
        phone_e164: r.phone,
        token: r.token,
        platform: r.platform,
        ticket_id: ok && t.status === "ok" ? t.id : null,
        ticket_error: ticketError,
      });
    });
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("push_run_recipients").insert(rows.slice(i, i + 500));
    if (error) console.error("[push-center] recipients insert failed:", error.message);
  }
  await admin
    .from("push_runs")
    .update({ accepted_count: accepted, errored_count: errored })
    .eq("id", runId);

  for (const token of dead) {
    await deleteDevicePushToken(token).catch((err) =>
      console.error("[push-center] delete dead token failed:", err),
    );
  }

  console.log(
    `[push-center] run ${runId} ${args.campaign}: Expo accepted ${accepted}/${recipients.length}` +
      (errored ? `, ${errored} refused` : ""),
  );

  const later = () =>
    new Promise((resolve) => setTimeout(resolve, RECEIPT_DELAY_MS))
      .then(() => checkRunReceipts(runId))
      .catch((err) => console.error("[push-center] receipt check failed:", err));
  try {
    after(later);
  } catch {
    void later();
  }

  return { runId, targeted: recipients.length, accepted, errored, errors };
}

export type ReceiptSummary = { delivered: number; failed: number; pending: number };

/**
 * Ask Expo how the accepted tickets of a run ended up, and write it back.
 * Safe to call again later: only rows still without a receipt are asked
 * about (Expo keeps receipts for a day).
 */
export async function checkRunReceipts(runId: string): Promise<ReceiptSummary> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("push_run_recipients")
    .select("id,token,ticket_id")
    .eq("run_id", runId)
    .not("ticket_id", "is", null)
    .is("receipt_status", null)
    .limit(5000);
  if (error) throw new Error(`push_run_recipients read: ${error.message}`);
  const pendingRows = (data ?? []) as Array<{ id: string; token: string; ticket_id: string }>;

  const byTicket = new Map(pendingRows.map((r) => [r.ticket_id, r]));
  const dead: string[] = [];
  let resolved = 0;
  for (const ids of expo.chunkPushNotificationReceiptIds([...byTicket.keys()])) {
    const receipts = await expo.getPushNotificationReceiptsAsync(ids);
    for (const [ticketId, receipt] of Object.entries(receipts)) {
      const row = byTicket.get(ticketId);
      if (!row) continue;
      const status = receipt.status === "ok" ? "ok" : (receipt.details?.error ?? "error");
      const message = receipt.status === "ok" ? null : (receipt.message ?? null);
      const { error: upErr } = await admin
        .from("push_run_recipients")
        .update({ receipt_status: status, receipt_message: message, receipt_at: new Date().toISOString() })
        .eq("id", row.id);
      if (upErr) console.error("[push-center] receipt write failed:", upErr.message);
      else resolved++;
      if (status === "DeviceNotRegistered") dead.push(row.token);
    }
  }
  for (const token of dead) {
    await deleteDevicePushToken(token).catch((err) =>
      console.error("[push-center] delete dead token failed:", err),
    );
  }

  const { data: agg, error: aggErr } = await admin
    .from("push_run_recipients")
    .select("receipt_status,ticket_id")
    .eq("run_id", runId)
    .limit(5000);
  if (aggErr) throw new Error(`push_run_recipients aggregate: ${aggErr.message}`);
  let delivered = 0;
  let failed = 0;
  let pending = 0;
  for (const r of (agg ?? []) as Array<{ receipt_status: string | null; ticket_id: string | null }>) {
    if (!r.ticket_id) continue;
    if (r.receipt_status === "ok") delivered++;
    else if (r.receipt_status) failed++;
    else pending++;
  }
  await admin
    .from("push_runs")
    .update({ delivered_count: delivered, failed_count: failed, receipts_checked_at: new Date().toISOString() })
    .eq("id", runId);
  console.log(`[push-center] run ${runId} receipts: ${delivered} delivered, ${failed} failed, ${pending} pending (${resolved} new)`);
  return { delivered, failed, pending };
}
