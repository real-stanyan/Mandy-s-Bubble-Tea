import "server-only";
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
 * immediately; Expo-side delivery errors are logged (receipt polling
 * would be a v2 concern — for order-ready notifications, best-effort
 * delivery is acceptable because the order is also visible in-app).
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
  for (const chunk of chunks) {
    try {
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const token = chunk[i].to as string;
        if (ticket.status === "ok") {
          accepted++;
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
  return accepted;
}
