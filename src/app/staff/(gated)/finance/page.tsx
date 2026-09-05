import { notFound } from "next/navigation";
import { hasAtLeast } from "@/lib/staff/auth";
import { buildFinanceView, defaultRange } from "@/lib/staff/finance-store";
import { FinanceClient } from "./finance-client";

export const dynamic = "force-dynamic";
// First load may walk a quarter of Square orders before the per-day cache
// is warm.
export const maxDuration = 60;

export default async function FinancePage() {
  // Owner only: takings, wages and margins are nobody else's business.
  if (!(await hasAtLeast("owner"))) notFound();
  const { from, to } = defaultRange();
  return <FinanceClient initial={await buildFinanceView(from, to)} />;
}
