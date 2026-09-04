import { NextResponse } from "next/server";
import { hasAtLeast } from "@/lib/staff/auth";
import { brisbaneDate } from "@/lib/staff/stock-history";
import { readInventory, writeInventory } from "@/lib/staff/inventory-store";
import { parseReports } from "@/lib/staff/report-import";
import {
  addItem,
  applyPickup,
  buildView,
  mergeShopCounts,
  patchItems,
  removeItem,
  setCoverDays,
  trackItem,
  type ItemPatch,
  type PickupLine,
} from "@/lib/staff/inventory";

export const dynamic = "force-dynamic";

// Owner only, both ways. The warehouse is Stan's, and a pickup confirmed by
// the wrong person takes stock out of a count nobody else can see.

type Body =
  | { action: "patch-items"; items: ItemPatch[] }
  | { action: "add-item"; name: string; category: string; unit?: string; qty?: number | null; threshold?: number | null }
  | { action: "delete-item"; id: string }
  | { action: "track-item"; id: string }
  | { action: "confirm-pickup"; lines: PickupLine[]; by?: string }
  | { action: "set-cover-days"; coverDays: number }
  | { action: "import-reports"; text: string };

export async function GET() {
  if (!(await hasAtLeast("owner"))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const now = new Date();
  const state = await readInventory(now);
  return NextResponse.json({ ok: true, view: buildView(state, brisbaneDate(now)) });
}

export async function POST(request: Request) {
  if (!(await hasAtLeast("owner"))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object" || !("action" in body)) {
    return NextResponse.json({ ok: false, error: "bad-request" }, { status: 400 });
  }

  const now = new Date();
  const today = brisbaneDate(now);
  const state = await readInventory(now);
  let next = state;

  switch (body.action) {
    case "patch-items":
      next = patchItems(state, Array.isArray(body.items) ? body.items : [], now);
      break;
    case "add-item": {
      const r = addItem(state, body, now);
      if (!r.item) return NextResponse.json({ ok: false, error: "name-required" }, { status: 400 });
      next = r.state;
      break;
    }
    case "delete-item":
      next = removeItem(state, String(body.id), now);
      break;
    case "track-item":
      next = trackItem(state, String(body.id), now);
      break;
    case "confirm-pickup":
      next = applyPickup(state, Array.isArray(body.lines) ? body.lines : [], today, body.by?.trim() || null, now);
      if (next === state) return NextResponse.json({ ok: false, error: "nothing-to-pick" }, { status: 400 });
      break;
    case "set-cover-days":
      next = setCoverDays(state, body.coverDays);
      break;
    case "import-reports": {
      const parsed = parseReports(String(body.text ?? "").slice(0, 400_000));
      const merged = mergeShopCounts(state, parsed.counts);
      next = merged.state;
      if (!(await writeInventory(next))) {
        return NextResponse.json({ ok: false, error: "save-failed" }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        view: buildView(next, today),
        imported: {
          days: parsed.counts.length,
          added: merged.added,
          unknown: parsed.unknown,
          ambiguous: parsed.ambiguous,
        },
      });
    }
    default:
      return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 });
  }

  if (!(await writeInventory(next))) {
    return NextResponse.json({ ok: false, error: "save-failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, view: buildView(next, today) });
}
