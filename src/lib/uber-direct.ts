import crypto from "crypto";

// Uber Direct client. Mock mode (set UBER_DIRECT_MODE=mock) returns
// fixture data without any network call so Phase 1–3 development can
// proceed without a real Uber merchant account. Sandbox/production
// modes call the real Uber Direct REST API at api.uber.com.

export type QuoteRequest = {
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffPhone: string;     // E.164
  dropoffName: string;
  orderValueCents: number;
};

export type QuoteResultOk = {
  ok: true;
  quoteId: string;
  etaMin: number;
  expiresAt: string;        // ISO
};

export type QuoteResultErr = {
  ok: false;
  reason: "out_of_zone" | "no_driver" | "invalid_address" | "internal";
  detail?: string;
};

export type QuoteResult = QuoteResultOk | QuoteResultErr;

export type CreateDeliveryRequest = {
  quoteId: string;
  externalOrderId: string;  // Square order id or pickup number
  pickupNote?: string;
  dropoffNote?: string;
};

export type CreateDeliveryResultOk = {
  ok: true;
  deliveryId: string;
  trackingUrl: string;
};

export type CreateDeliveryResultErr = {
  ok: false;
  status: number;
  retryable: boolean;
  detail?: string;
};

export type CreateDeliveryResult = CreateDeliveryResultOk | CreateDeliveryResultErr;

export type UberDeliveryStatus =
  | "pending"
  | "pickup"
  | "pickup_complete"
  | "dropoff"
  | "delivered"
  | "canceled"
  | "failed"
  | "returned";

function getMode(): "mock" | "sandbox" | "production" {
  const m = process.env.UBER_DIRECT_MODE;
  if (m === "sandbox" || m === "production") return m;
  return "mock";
}

// ---- Mock implementations -------------------------------------------------

function mockQuote(req: QuoteRequest): QuoteResult {
  if (req.dropoffAddress.includes("__OOZ__")) {
    return { ok: false, reason: "out_of_zone" };
  }
  if (req.dropoffAddress.includes("__NODRIVER__")) {
    return { ok: false, reason: "no_driver" };
  }
  return {
    ok: true,
    quoteId: `mock_quote_${Date.now().toString(36)}`,
    etaMin: 25,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}

function mockCreateDelivery(req: CreateDeliveryRequest): CreateDeliveryResult {
  if (req.quoteId.includes("__FAIL__")) {
    return { ok: false, status: 503, retryable: true, detail: "mock failure" };
  }
  const id = `mock_delivery_${Date.now().toString(36)}`;
  return {
    ok: true,
    deliveryId: id,
    trackingUrl: `https://mock.uber.com/track/${id}`,
  };
}

// ---- Real Uber Direct API (sandbox + production) -------------------------
// Phase 4 wires these. Stubs left in place for typecheck.

async function realQuote(_req: QuoteRequest): Promise<QuoteResult> {
  // TODO Phase 4: POST /v1/customers/{customer_id}/delivery_quotes
  // with OAuth bearer token (cached per Edge runtime).
  throw new Error("uber-direct: real API not yet wired (Phase 4)");
}

async function realCreateDelivery(_req: CreateDeliveryRequest): Promise<CreateDeliveryResult> {
  // TODO Phase 4: POST /v1/customers/{customer_id}/deliveries with quote_id.
  throw new Error("uber-direct: real API not yet wired (Phase 4)");
}

// ---- Public API -----------------------------------------------------------

export async function quoteDelivery(req: QuoteRequest): Promise<QuoteResult> {
  if (getMode() === "mock") return mockQuote(req);
  return realQuote(req);
}

export async function createDelivery(req: CreateDeliveryRequest): Promise<CreateDeliveryResult> {
  if (getMode() === "mock") return mockCreateDelivery(req);
  return realCreateDelivery(req);
}

// HMAC-SHA256 webhook signature check. Constant-time compare to dodge
// timing attacks. Header name: x-uber-signature (Uber Direct convention).
export function verifyWebhookSignature(rawBody: string, signatureHex: string): boolean {
  const secret = process.env.UBER_DIRECT_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== signatureHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signatureHex, "hex"));
}

// Maps Uber webhook event status → Square fulfillment.state.
export function mapUberStatusToSquareState(
  uberStatus: UberDeliveryStatus,
): "RESERVED" | "PREPARED" | "COMPLETED" | "CANCELED" {
  switch (uberStatus) {
    case "pending":
      return "RESERVED";
    case "pickup":
    case "pickup_complete":
    case "dropoff":
      return "PREPARED";
    case "delivered":
      return "COMPLETED";
    case "canceled":
    case "failed":
    case "returned":
      return "CANCELED";
  }
}
