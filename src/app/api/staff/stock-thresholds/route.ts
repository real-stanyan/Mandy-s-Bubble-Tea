import { NextResponse } from "next/server";
import { hasAtLeast } from "@/lib/staff/auth";
import { readThresholds, writeThresholds } from "@/lib/staff/threshold-store";
import { ALL_ITEMS, defaultThreshold, type ThresholdOverrides } from "@/lib/staff/stocklist";

export const dynamic = "force-dynamic";

type Body = {
  /** item id -> the new threshold, or null/"" to go back to the default. */
  thresholds?: Record<string, string | number | null>;
  changedBy?: string;
};

export async function POST(request: Request) {
  // Owner, not staff. Counting is everyone's job; deciding when the shop
  // reorders is not, and a threshold nudged down quietly under-orders for
  // weeks before anyone notices a gap on the shelf.
  if (!(await hasAtLeast("owner"))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const raw = body.thresholds ?? {};
  const changedBy = body.changedBy?.trim() || null;
  const now = new Date().toISOString();

  const existing = await readThresholds();
  const next: ThresholdOverrides = { ...existing };

  for (const [id, value] of Object.entries(raw)) {
    const item = ALL_ITEMS.find((i) => i.id === id);
    // Unknown id, or an item that has no threshold to override. Silently
    // skipping beats storing a number nothing will ever read.
    if (!item || item.rule.kind !== "threshold") continue;

    if (value === null || value === "") {
      delete next[id];
      continue;
    }
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) continue;

    // Back to the default means no override at all, rather than an override
    // that happens to equal it — otherwise the editor would show "changed"
    // forever on a number nobody actually changed.
    if (parsed === defaultThreshold(id)) {
      delete next[id];
      continue;
    }
    next[id] = { value: parsed, by: changedBy, at: now };
  }

  const saved = await writeThresholds(next);
  if (!saved) {
    return NextResponse.json({ ok: false, error: "save-failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, thresholds: next });
}
