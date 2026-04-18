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

/**
 * Look up a Square Customer by E.164 phone. Fetches up to two matches
 * so we can log a warning when the merchant has accidentally created
 * duplicate records for the same phone (happens on POS imports or
 * manual entry). The returned customer is deterministically the first
 * one Square hands back — same as before — but callers now get a
 * visible signal in the logs instead of silently picking one.
 */
type SquareCustomer = NonNullable<
  Awaited<ReturnType<typeof squareClient.customers.search>>["customers"]
>[number];

export async function findCustomerByPhone(
  e164: string,
): Promise<SquareCustomer | null> {
  const search = await squareClient.customers.search({
    limit: BigInt(2),
    query: { filter: { phoneNumber: { exact: e164 } } },
  });
  const customers = search.customers ?? [];
  if (customers.length > 1) {
    console.warn(
      `[square] multiple Square customer records share phone ${e164}: ${customers
        .map((c) => c.id)
        .join(", ")}. Merge them in Square Dashboard to avoid stars going to the wrong account.`,
    );
  }
  return customers[0] ?? null;
}
