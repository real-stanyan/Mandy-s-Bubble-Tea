import { notFound } from "next/navigation";
import { hasAtLeast } from "@/lib/staff/auth";
import { buildView } from "@/lib/staff/inventory";
import { readInventory } from "@/lib/staff/inventory-store";
import { brisbaneDate } from "@/lib/staff/stock-history";
import { InventoryClient } from "./inventory-client";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  // Owner only — the warehouse and what to carry from it are Stan's, and the
  // layout above has already established the visitor is signed in.
  if (!(await hasAtLeast("owner"))) notFound();
  const now = new Date();
  const state = await readInventory(now);
  return <InventoryClient initial={buildView(state, brisbaneDate(now))} />;
}
