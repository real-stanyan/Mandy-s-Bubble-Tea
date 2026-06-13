// scripts/setup-tier-pos-discount.ts
// One-time (rerunnable) Square setup for the POS tier discount:
//   - customer groups "Tier: Gold" / "Tier: Diamond"
//   - catalog triple: Member 5% discount + all-products set + pricing rule
//     with customerGroupIdsAny = [gold, diamond]
// Find-or-create on names — safe to rerun; never duplicates.
// CAVEAT: matching is by display name — do NOT rename "Tier: Gold" /
// "Tier: Diamond" / "Tier member 5% off" in the Square Dashboard, or a
// rerun will fail to find them and create duplicates.
// Run: set -a; source .env.production; set +a; npx tsx scripts/setup-tier-pos-discount.ts
import { randomUUID } from "node:crypto";
import { SquareClient, SquareEnvironment } from "square";

const token = process.env.SQUARE_ACCESS_TOKEN;
if (!token) {
  console.error("SQUARE_ACCESS_TOKEN missing");
  process.exit(1);
}
const client = new SquareClient({
  token,
  environment:
    (process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "production") === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
});

const GOLD_NAME = "Tier: Gold";
const DIAMOND_NAME = "Tier: Diamond";
const DISCOUNT_NAME = "Member 5%";
const PRODUCT_SET_NAME = "All products (tier discount)";
const RULE_NAME = "Tier member 5% off";

async function ensureGroup(name: string): Promise<string> {
  // Page wrapper: groups live on page.response.groups (NOT page.groups).
  let page = await client.customers.groups.list({});
  for (;;) {
    const hit = (page.response.groups ?? []).find((g) => g.name === name);
    if (hit?.id) {
      console.log(`group exists: "${name}" → ${hit.id}`);
      return hit.id;
    }
    if (!page.hasNextPage()) break;
    page = await page.getNextPage();
  }
  const created = await client.customers.groups.create({
    idempotencyKey: randomUUID(),
    group: { name },
  });
  const id = created.group?.id;
  if (!id) throw new Error(`create group "${name}" returned no id`);
  console.log(`group created: "${name}" → ${id}`);
  return id;
}

async function findPricingRuleByName(name: string) {
  let cursor: string | undefined;
  do {
    const res = await client.catalog.search({
      objectTypes: ["PRICING_RULE"],
      cursor,
    });
    const hit = (res.objects ?? []).find(
      (o) => o.type === "PRICING_RULE" && o.pricingRuleData?.name === name,
    );
    if (hit) return hit;
    cursor = res.cursor ?? undefined;
  } while (cursor);
  return undefined;
}

async function main() {
  const goldId = await ensureGroup(GOLD_NAME);
  const diamondId = await ensureGroup(DIAMOND_NAME);

  const existing = await findPricingRuleByName(RULE_NAME);
  if (existing) {
    console.log(`pricing rule exists: "${RULE_NAME}" → ${existing.id} (skipping catalog upsert)`);
  } else {
    const res = await client.catalog.batchUpsert({
      idempotencyKey: randomUUID(),
      batches: [
        {
          objects: [
            {
              type: "DISCOUNT",
              id: "#tier-discount",
              presentAtAllLocations: true,
              discountData: {
                name: DISCOUNT_NAME,
                discountType: "FIXED_PERCENTAGE",
                percentage: "5.0",
              },
            },
            {
              type: "PRODUCT_SET",
              id: "#tier-products",
              presentAtAllLocations: true,
              productSetData: { name: PRODUCT_SET_NAME, allProducts: true },
            },
            {
              type: "PRICING_RULE",
              id: "#tier-rule",
              presentAtAllLocations: true,
              pricingRuleData: {
                name: RULE_NAME,
                discountId: "#tier-discount",
                matchProductsId: "#tier-products",
                customerGroupIdsAny: [goldId, diamondId],
              },
            },
          ],
        },
      ],
    });
    for (const m of res.idMappings ?? []) {
      console.log(`catalog created: ${m.clientObjectId} → ${m.objectId}`);
    }
  }

  console.log("\nSet these in Vercel env (production) AND .env.local / .env.production:");
  console.log(`SQUARE_TIER_GROUP_GOLD_ID=${goldId}`);
  console.log(`SQUARE_TIER_GROUP_DIAMOND_ID=${diamondId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
