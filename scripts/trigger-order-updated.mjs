// Local signed Square-webhook tester for `order.updated`.
//
// Use this to simulate a POS cash/card payment that closes an order,
// which is the normal trigger for enqueuePrintJob. Useful because
// you can't easily make a real POS transaction from a laptop, and
// it lets you test the print pipeline end-to-end without running
// the register.
//
// Usage (from project root):
//   SQUARE_WEBHOOK_SIGNATURE_KEY=... \
//   SQUARE_WEBHOOK_NOTIFICATION_URL=https://mandybubbletea.com/api/webhooks/square \
//     node scripts/trigger-order-updated.mjs <orderId>
//
// orderId must be a real Square order_id that Square can retrieve —
// the webhook handler calls orders.get to re-fetch before enqueuing.
// POS orders that have actually been paid are the right kind of id
// to use here; the handler's gate (tenders >= 1 or state=COMPLETED)
// will reject anything not actually settled.

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
  console.error("Usage: node scripts/trigger-order-updated.mjs <orderId>");
  process.exit(1);
}

const event = {
  merchant_id: "test",
  type: "order.updated",
  event_id: `test-updated-${Date.now()}`,
  created_at: new Date().toISOString(),
  data: {
    type: "order_updated",
    id: orderId,
    object: {
      order_updated: {
        order_id: orderId,
        state: "COMPLETED",
        version: 1,
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
  "\nOK. Look for '[square-webhook] print enqueue result' in Vercel logs,",
);
console.log(
  "and a new row in print_jobs keyed by square_order_id=" + orderId + ".",
);
