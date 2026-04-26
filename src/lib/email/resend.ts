// src/lib/email/resend.ts
import "server-only";
import { Resend } from "resend";

let cached: Resend | null = null;

/**
 * Returns the singleton Resend client. Throws at first call if
 * RESEND_API_KEY is missing — failure is loud so misconfigured deploys
 * trip the route's 502 path immediately.
 */
export function getResendClient(): Resend {
  if (cached) return cached;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  cached = new Resend(apiKey);
  return cached;
}

export const COMPLAINT_TO_EMAIL =
  process.env.COMPLAINT_TO_EMAIL ?? "hello@mandybubbletea.com";

export const COMPLAINT_FROM_EMAIL =
  process.env.COMPLAINT_FROM_EMAIL ??
  "Mandy's Bubble Tea <noreply@mandybubbletea.com>";
