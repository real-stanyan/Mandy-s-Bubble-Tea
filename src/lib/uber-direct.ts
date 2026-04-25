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

export type DeliveryDetail = {
  status: UberDeliveryStatus;
  trackingUrl: string;
  pickupEta: string | null;   // ISO
  dropoffEta: string | null;  // ISO
  pickup: { lat: number; lng: number } | null;
  dropoff: { lat: number; lng: number } | null;
  courier: {
    name: string | null;
    phone: string | null;
    vehicleMake: string | null;
    vehicleModel: string | null;
    vehicleColor: string | null;
    location: { lat: number; lng: number } | null;
    imgHref: string | null;
  } | null;
};

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
  if (m === "mock" || m === "sandbox" || m === "production") return m;
  // Default to production: fail-closed if env is misconfigured. This intentionally
  // throws via the realQuote/realCreateDelivery stubs (Phase 4) rather than
  // silently mocking, so a missing env var on Vercel is loudly visible.
  return "production";
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

// Mock delivery state machine — derives a status from how long the
// delivery id has existed, so the UI can show progression while testing
// without a real Uber merchant account.
// Per-deliveryId "first seen" timestamps so the mock animation always
// starts from t=0 on the first poll of a session. Without this, opening
// the order page after the 60s window leaves you on "delivered" and the
// rider never appears to move.
const mockSessionStart = new Map<string, number>();
function mockGetDelivery(deliveryId: string): DeliveryDetail {
  let ts = mockSessionStart.get(deliveryId);
  if (!ts) {
    ts = Date.now();
    mockSessionStart.set(deliveryId, ts);
  }
  const ageSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  // Compressed mock timeline: ~60s total so devs can see all phases quickly.
  const status: UberDeliveryStatus =
    ageSec < 8
      ? "pending"
      : ageSec < 22
        ? "pickup"
        : ageSec < 30
          ? "pickup_complete"
          : ageSec < 55
            ? "dropoff"
            : "delivered";

  // Pickup = store. Dropoff = ~1km north. Courier interpolates between
  // a depot start, the pickup, then the dropoff over the 240s lifecycle.
  const pickup = { lat: -28.0084, lng: 153.4116 };
  const dropoff = { lat: -27.9990, lng: 153.4150 };
  const depot = { lat: -28.0150, lng: 153.4050 };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
  let courierLoc: { lat: number; lng: number };
  if (status === "pickup") {
    const t = (ageSec - 8) / 14;
    courierLoc = { lat: lerp(depot.lat, pickup.lat, t), lng: lerp(depot.lng, pickup.lng, t) };
  } else if (status === "pickup_complete") {
    courierLoc = pickup;
  } else if (status === "dropoff") {
    const t = (ageSec - 30) / 25;
    courierLoc = { lat: lerp(pickup.lat, dropoff.lat, t), lng: lerp(pickup.lng, dropoff.lng, t) };
  } else if (status === "delivered") {
    courierLoc = dropoff;
  } else {
    courierLoc = depot;
  }

  return {
    status,
    trackingUrl: `https://mock.uber.com/track/${deliveryId}`,
    pickupEta: new Date(ts + 22_000).toISOString(),
    dropoffEta: new Date(ts + 55_000).toISOString(),
    pickup,
    dropoff,
    courier:
      status === "pending"
        ? null
        : {
            name: "Alex",
            phone: "+61400000000",
            vehicleMake: "Toyota",
            vehicleModel: "Corolla",
            vehicleColor: "White",
            location: courierLoc,
            imgHref: null,
          },
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

type CachedToken = { token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

async function getOAuthToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const clientId = process.env.UBER_DIRECT_CLIENT_ID;
  const clientSecret = process.env.UBER_DIRECT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Uber Direct credentials not configured");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "eats.deliveries",
  });
  const res = await fetch("https://login.uber.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Uber OAuth failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

function uberApiBase(): string {
  return process.env.UBER_DIRECT_MODE === "production"
    ? "https://api.uber.com"
    : "https://sandbox-api.uber.com";
}

const PICKUP_ADDRESS_JSON = JSON.stringify({
  street_address: ["34 Davenport St"],
  city: "Southport",
  state: "QLD",
  zip_code: "4215",
  country: "AU",
});
const PICKUP_BUSINESS_NAME = "Mandy's Bubble Tea";
const PICKUP_PHONE = "+61404978238";

async function realQuote(req: QuoteRequest): Promise<QuoteResult> {
  const token = await getOAuthToken();
  const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
  if (!customerId) throw new Error("UBER_DIRECT_CUSTOMER_ID not configured");

  const res = await fetch(
    `${uberApiBase()}/v1/customers/${customerId}/delivery_quotes`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pickup_address: PICKUP_ADDRESS_JSON,
        dropoff_address: JSON.stringify({
          street_address: [req.dropoffAddress],
          country: "AU",
        }),
        dropoff_phone_number: req.dropoffPhone,
        manifest_total_value: req.orderValueCents,
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 422) return { ok: false, reason: "out_of_zone", detail };
    if (res.status === 503) return { ok: false, reason: "no_driver", detail };
    return { ok: false, reason: "internal", detail };
  }
  const data = (await res.json()) as {
    id: string;
    duration: number; // seconds
    expires: string;
  };
  return {
    ok: true,
    quoteId: data.id,
    etaMin: Math.round(data.duration / 60),
    expiresAt: data.expires,
  };
}

async function realCreateDelivery(
  req: CreateDeliveryRequest,
): Promise<CreateDeliveryResult> {
  const token = await getOAuthToken();
  const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
  if (!customerId) throw new Error("UBER_DIRECT_CUSTOMER_ID not configured");

  const res = await fetch(
    `${uberApiBase()}/v1/customers/${customerId}/deliveries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        quote_id: req.quoteId,
        external_id: req.externalOrderId,
        pickup_business_name: PICKUP_BUSINESS_NAME,
        pickup_phone_number: PICKUP_PHONE,
        pickup_notes: req.pickupNote,
        dropoff_notes: req.dropoffNote,
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    return {
      ok: false,
      status: res.status,
      retryable: res.status >= 500 || res.status === 429,
      detail,
    };
  }
  const data = (await res.json()) as { id: string; tracking_url: string };
  return { ok: true, deliveryId: data.id, trackingUrl: data.tracking_url };
}

async function realGetDelivery(deliveryId: string): Promise<DeliveryDetail> {
  const token = await getOAuthToken();
  const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
  if (!customerId) throw new Error("UBER_DIRECT_CUSTOMER_ID not configured");
  const res = await fetch(
    `${uberApiBase()}/v1/customers/${customerId}/deliveries/${deliveryId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Uber getDelivery failed: ${res.status}`);
  const data = (await res.json()) as {
    status: UberDeliveryStatus;
    tracking_url?: string;
    pickup_eta?: string;
    dropoff_eta?: string;
    pickup?: { location?: { lat: number; lng: number } };
    dropoff?: { location?: { lat: number; lng: number } };
    courier?: {
      name?: string;
      phone_number?: string;
      vehicle_make?: string;
      vehicle_model?: string;
      vehicle_color?: string;
      location?: { lat: number; lng: number };
      img_href?: string;
    };
  };
  return {
    status: data.status,
    trackingUrl: data.tracking_url ?? "",
    pickupEta: data.pickup_eta ?? null,
    dropoffEta: data.dropoff_eta ?? null,
    pickup: data.pickup?.location ?? null,
    dropoff: data.dropoff?.location ?? null,
    courier: data.courier
      ? {
          name: data.courier.name ?? null,
          phone: data.courier.phone_number ?? null,
          vehicleMake: data.courier.vehicle_make ?? null,
          vehicleModel: data.courier.vehicle_model ?? null,
          vehicleColor: data.courier.vehicle_color ?? null,
          location: data.courier.location ?? null,
          imgHref: data.courier.img_href ?? null,
        }
      : null,
  };
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

export async function getDelivery(deliveryId: string): Promise<DeliveryDetail> {
  if (getMode() === "mock") return mockGetDelivery(deliveryId);
  return realGetDelivery(deliveryId);
}

// HMAC-SHA256 webhook signature check. Constant-time compare to dodge
// timing attacks. Header name: x-uber-signature (Uber Direct convention).
export function verifyWebhookSignature(rawBody: string, signatureHex: string): boolean {
  const secret = process.env.UBER_DIRECT_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  // Compare BYTE length, not hex-string length: Buffer.from(invalidHex, "hex")
  // silently drops non-hex chars, so two same-length hex strings can produce
  // different-byte-length buffers and crash timingSafeEqual.
  const expectedBuf = Buffer.from(expected, "hex");
  const sigBuf = Buffer.from(signatureHex, "hex");
  if (expectedBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

// Maps Uber webhook event status → Square fulfillment.state.
// NOTE — information loss: `canceled`, `failed`, `returned` all collapse to
// `CANCELED` because Square's fulfillment.state enum is fixed. The webhook
// handler (Task 20) MUST persist the raw uber status alongside (e.g., on
// `order.metadata.uberLastStatus`) so ops can distinguish:
//   - canceled: customer/shop canceled before pickup → refund
//   - failed: Uber system error → retry-quote
//   - returned: driver couldn't reach customer, package came back → refund + reach out
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
