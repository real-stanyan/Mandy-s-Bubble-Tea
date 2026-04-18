// Verify that the Square tenant has been wiped before we flip to
// Supabase Auth. Queries the Square Customers API and reports the
// count + a sample. Non-destructive.
//
// Usage (from project root):
//   SQUARE_ACCESS_TOKEN=... NEXT_PUBLIC_SQUARE_ENVIRONMENT=production \
//     node scripts/verify-clean.mjs

import { SquareClient, SquareEnvironment } from "square";

const token = process.env.SQUARE_ACCESS_TOKEN;
if (!token) {
  console.error("SQUARE_ACCESS_TOKEN is not set");
  process.exit(1);
}

const envName = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "production";
const client = new SquareClient({
  token,
  environment:
    envName === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
});

const customers = [];
let cursor;
do {
  const res = await client.customers.search({ limit: BigInt(100), cursor });
  for (const c of res.customers ?? []) customers.push(c);
  cursor = res.cursor;
} while (cursor);

console.log(`Square customers remaining: ${customers.length}`);
if (customers.length > 0) {
  console.log("Sample:");
  for (const c of customers.slice(0, 5)) {
    console.log(`  ${c.id}  ${c.phoneNumber ?? "-"}  ${c.givenName ?? ""} ${c.familyName ?? ""}`);
  }
}

// Loyalty accounts — Square does not expose a public delete endpoint for
// these, so they typically stay until manually purged by Square Support
// or become orphaned when their customer is removed. Counting them here
// is diagnostic only.
const loyaltyAccounts = [];
let lcursor;
do {
  const res = await client.loyalty.accounts.search({ limit: 100, cursor: lcursor });
  for (const a of res.loyaltyAccounts ?? []) loyaltyAccounts.push(a);
  lcursor = res.cursor;
} while (lcursor);

console.log(`Square loyalty accounts remaining: ${loyaltyAccounts.length}`);
if (loyaltyAccounts.length > 0) {
  console.log("(Loyalty accounts can't be deleted via public API. They may linger");
  console.log(" as orphans after customer deletion; contact Square support if the");
  console.log(" Dashboard list needs to be fully cleared.)");
}
