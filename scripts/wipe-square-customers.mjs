// Bulk-delete every Square customer in the current environment. This
// exists so the clean-slate migration to Supabase Auth doesn't require
// you to click "delete" 100× in the Dashboard. Destructive — run once
// after confirming you really do want a blank customer list.
//
// Usage (from project root):
//   SQUARE_ACCESS_TOKEN=... NEXT_PUBLIC_SQUARE_ENVIRONMENT=production \
//     node scripts/wipe-square-customers.mjs --yes
//
// Without --yes the script prints what it *would* delete and exits.

import { SquareClient, SquareEnvironment } from "square";

const token = process.env.SQUARE_ACCESS_TOKEN;
if (!token) {
  console.error("SQUARE_ACCESS_TOKEN is not set");
  process.exit(1);
}

const confirm = process.argv.includes("--yes");

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

console.log(`Found ${customers.length} customers in ${envName}.`);

if (!confirm) {
  console.log("\nDry run. Pass --yes to actually delete.");
  process.exit(0);
}

let deleted = 0;
let failed = 0;
for (const c of customers) {
  if (!c.id) continue;
  try {
    await client.customers.delete({ customerId: c.id });
    deleted++;
    if (deleted % 25 === 0) console.log(`  deleted ${deleted}/${customers.length}`);
  } catch (err) {
    failed++;
    console.warn(`  delete failed for ${c.id}: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`\nDone. Deleted ${deleted}, failed ${failed}.`);
