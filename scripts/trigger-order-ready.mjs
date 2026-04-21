// Local signed Square-webhook tester. Fires a real
// `order.fulfillment.updated` event with new_state=PREPARED against the
// configured webhook URL. Useful for verifying the order-ready push
// path end-to-end without waiting for POS to flip a real order.
//
// Usage (from project root):
//   SQUARE_WEBHOOK_SIGNATURE_KEY=... \
//   SQUARE_WEBHOOK_NOTIFICATION_URL=https://mandybubbletea.com/api/webhooks/square \
//     node scripts/trigger-order-ready.mjs <orderId>
//
// orderId must be a real Square order_id that:
//   - belongs to a customer mapped to a Supabase user_profile
//   - that user has registered a device push token
// Otherwise the handler will log a skip reason and no push will arrive.
//
// The signature is computed exactly the way Square does it
// (HMAC-SHA256 of `notificationUrl + rawBody`, base64-encoded) so the
// server-side WebhooksHelper.verifySignature check passes.

import crypto from "node:crypto";

const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;
const orderId = process.argv[2];

if (!signatureKey) {
  console.error("SQUARE_WEBHOOK_SIGNATURE_KEY is not set");
  process.exit(1);
}
if (!notificationUrl) {
  console.error("SQUARE_WEBHOOK_NOTIFICATION_URL is not set");
  process.exit(1);
}
if (!orderId) {
  console.error("Usage: node scripts/trigger-order-ready.mjs <orderId>");
  process.exit(1);
}

const event = {
  merchant_id: "test",
  type: "order.fulfillment.updated",
  event_id: `test-${Date.now()}`,
  created_at: new Date().toISOString(),
  data: {
    type: "order_fulfillment_updated",
    id: orderId,
    object: {
      order_fulfillment_updated: {
        order_id: orderId,
        state: "OPEN",
        fulfillment_update: [
          {
            fulfillment_uid: "test-fulfillment",
            old_state: "PROPOSED",
            new_state: "PREPARED",
          },
        ],
      },
    },
  },
};

const rawBody = JSON.stringify(event);
const signature = crypto
  .createHmac("sha256", signatureKey)
  .update(notificationUrl + rawBody)
  .digest("base64");

console.log(`POST ${notificationUrl}`);
console.log(`  order_id: ${orderId}`);
console.log(`  event_id: ${event.event_id}`);

const res = await fetch(notificationUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-square-hmacsha256-signature": signature,
  },
  body: rawBody,
});

const text = await res.text();
console.log(`-> ${res.status} ${text}`);

if (res.status !== 200) {
  process.exit(1);
}
console.log(
  "\nOK. Check your device for the push and Vercel logs for '[square-webhook]' lines.",
);
console.log(
  "Re-run to verify idempotency: you should see 'ready push already sent' on the 2nd call.",
);
