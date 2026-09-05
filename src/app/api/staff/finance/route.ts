import { NextResponse } from "next/server";
import { hasAtLeast } from "@/lib/staff/auth";
import { buildFinanceView, defaultRange, readFinance, writeFinance } from "@/lib/staff/finance-store";
import {
  parseDoorDashPayments,
  removeEntry,
  setRecurring,
  upsertEntry,
  type EntryKind,
} from "@/lib/staff/finance";

export const dynamic = "force-dynamic";
// The first request for a long range walks a quarter of Square orders; the
// per-day cache makes every later one cheap.
export const maxDuration = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function rangeFrom(params: URLSearchParams | Record<string, unknown>) {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : (params[k] as string | undefined));
  const def = defaultRange();
  const from = YMD.test(get("from") ?? "") ? (get("from") as string) : def.from;
  const to = YMD.test(get("to") ?? "") ? (get("to") as string) : def.to;
  return from <= to ? { from, to } : def;
}

export async function GET(request: Request) {
  if (!(await hasAtLeast("owner"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { from, to } = rangeFrom(new URL(request.url).searchParams);
  return NextResponse.json({ ok: true, view: await buildFinanceView(from, to) });
}

type Body =
  | { action: "add-entry"; kind: EntryKind; from: string; to?: string; amount: number; note?: string; ref?: string; id?: string }
  | { action: "delete-entry"; id: string }
  | { action: "set-recurring"; items: unknown[] }
  | { action: "import-doordash"; text: string };

export async function POST(request: Request) {
  if (!(await hasAtLeast("owner"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as (Body & { from?: string; to?: string; range?: { from: string; to: string } }) | null;
  if (!body || typeof body !== "object" || !("action" in body)) {
    return NextResponse.json({ ok: false, error: "bad-request" }, { status: 400 });
  }
  const now = new Date();
  const state = await readFinance();
  let next = state;
  let imported: { found: number } | undefined;

  switch (body.action) {
    case "add-entry":
      next = upsertEntry(
        state,
        { id: body.id, kind: body.kind, from: body.from, to: body.to ?? body.from, amount: Number(body.amount), note: body.note ?? "", ref: body.ref ?? "" },
        now,
      );
      if (next === state) return NextResponse.json({ ok: false, error: "bad-entry" }, { status: 400 });
      break;
    case "delete-entry":
      next = removeEntry(state, String(body.id));
      break;
    case "set-recurring":
      next = setRecurring(state, Array.isArray(body.items) ? body.items : []);
      break;
    case "import-doordash": {
      const found = parseDoorDashPayments(String(body.text ?? "").slice(0, 400_000));
      for (const p of found) next = upsertEntry(next, { kind: "doordash", ...p, note: "" }, now);
      imported = { found: found.length };
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 });
  }

  if (next !== state && !(await writeFinance(next))) {
    return NextResponse.json({ ok: false, error: "save-failed" }, { status: 500 });
  }
  const { from, to } = rangeFrom((body.range ?? {}) as Record<string, unknown>);
  return NextResponse.json({ ok: true, view: await buildFinanceView(from, to, now), ...(imported ? { imported } : {}) });
}
