import "server-only";
import { SquareClient, SquareEnvironment } from "square";

// Server-only Square SDK client. Never import this from a Client Component.
// Reads credentials from environment variables; throws on startup if missing
// so we fail fast instead of surfacing a cryptic 401 later.

const token = process.env.SQUARE_ACCESS_TOKEN;
if (!token) {
  throw new Error(
    "SQUARE_ACCESS_TOKEN is not set. Copy .env.example to .env.local and fill in sandbox credentials.",
  );
}

const envName = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "sandbox";
const environment =
  envName === "production"
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox;

export const squareClient = new SquareClient({
  token,
  environment,
});

export const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID ?? "";

/**
 * Ensure a Square Customer's reference_id equals the given E.164 phone.
 * Idempotent: skips the update if already in sync. Non-fatal: logs and
 * swallows errors so lookup flows never fail on sync issues. Safe to call
 * on every successful customer lookup.
 */
export async function ensureReferenceId(
  customerId: string,
  currentReferenceId: string | null | undefined,
  e164: string,
): Promise<void> {
  if (currentReferenceId === e164) return;
  try {
    await squareClient.customers.update({
      customerId,
      referenceId: e164,
    });
  } catch (err) {
    console.warn(
      "[square] failed to sync referenceId",
      err instanceof Error ? err.message : err,
    );
  }
}
