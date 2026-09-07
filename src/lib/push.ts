import "server-only";
import { after } from "next/server";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { deleteDevicePushToken } from "./push-tokens";

// Single shared client — Expo() is cheap but carries a retry queue
// so a module-level singleton is the documented pattern.
const expo = new Expo();

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/**
 * Send a push to one or many Expo tokens. Invalid tokens are pruned
 * immediately, and every accepted ticket is followed up with its delivery
 * receipt (see checkReceipts) — an accepted ticket only means Expo took the
 * message, not that APNs/FCM delivered it.
 *
 * Returns the count of accepted tickets.
 */
export async function sendExpoPush(
  tokens: string[],
  payload: PushPayload,
): Promise<number> {
  const valid: string[] = [];
  const malformed: string[] = [];
  for (const t of tokens) {
    if (!Expo.isExpoPushToken(t)) {
      const raw = t as string;
      console.warn(`[push] dropping malformed token (prefix=${raw.slice(0, 12)}… length=${raw.length})`);
      malformed.push(raw);
      continue;
    }
    valid.push(t);
  }
  if (malformed.length > 0) {
    await Promise.all(
      malformed.map((t) =>
        deleteDevicePushToken(t).catch((err) =>
          console.error("[push] delete malformed token failed:", err),
        ),
      ),
    );
  }
  if (valid.length === 0) return 0;

  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    priority: "high",
  }));
  return sendMessages(messages);
}

/**
 * Data-only variant: nothing is displayed by the OS — the payload wakes the
 * app's background task instead (Android order-status card refresh). Same
 * token pruning semantics as sendExpoPush.
 */
export async function sendExpoDataPush(
  tokens: string[],
  data: Record<string, unknown>,
): Promise<number> {
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (valid.length === 0) return 0;
  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    data,
    priority: "high",
    _contentAvailable: true,
  }));
  return sendMessages(messages);
}

async function sendMessages(messages: ExpoPushMessage[]): Promise<number> {
  const chunks = expo.chunkPushNotifications(messages);
  let accepted = 0;
  const sent: SentTicket[] = [];
  for (const chunk of chunks) {
    try {
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const token = chunk[i].to as string;
        if (ticket.status === "ok") {
          accepted++;
          sent.push({ id: ticket.id, token });
          continue;
        }
        if (ticket.status === "error") {
          console.error(
            `[push] ticket error for token prefix=${token.slice(0, 12)}…: ${ticket.message}`,
            ticket.details,
          );
          // Hard failures where the token is dead.
          if (ticket.details?.error === "DeviceNotRegistered") {
            await deleteDevicePushToken(token).catch((err) =>
              console.error("[push] delete stale token failed:", err),
            );
          }
        }
      }
    } catch (err) {
      console.error("[push] chunk send failed:", err);
    }
  }
  if (sent.length > 0) scheduleReceiptCheck(sent);
  return accepted;
}

type SentTicket = { id: string; token: string };

/** Receipts are usually ready within a few seconds; Expo keeps them for a day. */
const RECEIPT_DELAY_MS = 10_000;

/**
 * A ticket says Expo accepted the message. Whether APNs or FCM actually took
 * it only shows up in the receipt — which is where a whole platform can fail
 * silently: an FCM sender mismatch answered every send with an accepted
 * ticket while no Android device received anything (2026-09-07). The check
 * runs after the response is sent, so it costs the caller nothing.
 */
function scheduleReceiptCheck(sent: SentTicket[]): void {
  const run = () =>
    checkReceipts(sent).catch((err) => console.error("[push] receipt check failed:", err));
  try {
    // Request context (routes, webhooks): Next runs this after responding.
    after(run);
  } catch {
    // Outside a request (broadcast scripts): run it inline-detached.
    void run();
  }
}

async function checkReceipts(sent: SentTicket[]): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, RECEIPT_DELAY_MS));
  const byId = new Map(sent.map((s) => [s.id, s.token]));
  for (const ids of expo.chunkPushNotificationReceiptIds([...byId.keys()])) {
    const receipts = await expo.getPushNotificationReceiptsAsync(ids);
    for (const [id, receipt] of Object.entries(receipts)) {
      if (receipt.status === "ok") continue;
      const token = byId.get(id) ?? "";
      const error = receipt.details?.error ?? "unknown";
      console.error(
        `[push] not delivered (${error}) token prefix=${token.slice(0, 12)}…: ${receipt.message}`,
        receipt.details,
      );
      // The device uninstalled or the token rotated — stop sending to it.
      // Anything else (a credentials or rate problem) is ours to fix, and the
      // token stays: dropping live tokens over a server-side fault is worse.
      if (error === "DeviceNotRegistered" && token) {
        await deleteDevicePushToken(token).catch((err) =>
          console.error("[push] delete stale token failed:", err),
        );
      }
    }
  }
}
