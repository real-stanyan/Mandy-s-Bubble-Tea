import { notFound } from "next/navigation";
import { hasAtLeast } from "@/lib/staff/auth";
import { STOCK_LIST } from "@/lib/staff/stocklist";
import { readThresholds } from "@/lib/staff/threshold-store";
import { ThresholdEditor } from "./threshold-editor";

export const dynamic = "force-dynamic";

export default async function ThresholdsPage() {
  // notFound rather than a message: a staff member who is not the owner has
  // no business knowing this page exists, and the layout above already
  // establishes they are signed in.
  if (!(await hasAtLeast("owner"))) notFound();

  const overrides = await readThresholds();

  // Only threshold items are editable — weekly and sufficiency ones have no
  // number to compare against, so listing them would offer an edit that does
  // nothing.
  const categories = STOCK_LIST.map((c) => ({
    id: c.id,
    name: c.name,
    items: c.items
      .filter((i) => i.rule.kind === "threshold")
      .map((i) => ({
        id: i.id,
        name: i.name,
        // The default from stocklist.ts, always — the editor shows it beside
        // any override so a changed number can be read against what it was.
        fallback: i.rule.kind === "threshold" ? i.rule.value : 0,
      })),
  })).filter((c) => c.items.length > 0);

  return <ThresholdEditor categories={categories} overrides={overrides} />;
}
