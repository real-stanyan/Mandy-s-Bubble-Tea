import twilio from "twilio";
import { createHmac } from "crypto";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

const VERIFY_SID = process.env.TWILIO_VERIFY_SERVICE_SID!;
const TOKEN_SECRET = process.env.DEVICE_TOKEN_SECRET!;

// ── Twilio Verify ──

export async function sendVerification(to: string): Promise<void> {
  await client.verify.v2
    .services(VERIFY_SID)
    .verifications.create({ to, channel: "sms" });
}

export async function checkVerification(
  to: string,
  code: string,
): Promise<boolean> {
  const check = await client.verify.v2
    .services(VERIFY_SID)
    .verificationChecks.create({ to, code });
  return check.status === "approved";
}

// ── Device Token (HMAC-signed, no storage needed) ──

export function createDeviceToken(phone: string): string {
  const payload = Buffer.from(phone).toString("base64url");
  const sig = createHmac("sha256", TOKEN_SECRET)
    .update(payload)
    .digest("hex");
  return `${payload}.${sig}`;
}

export function verifyDeviceToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", TOKEN_SECRET)
    .update(payload)
    .digest("hex");
  if (sig !== expected) return null;
  try {
    return Buffer.from(payload, "base64url").toString();
  } catch {
    return null;
  }
}
