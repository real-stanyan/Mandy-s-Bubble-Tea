import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { hasAtLeast } from "@/lib/staff/auth";
import {
  STAFF,
  WEEKDAYS,
  type ShiftKind,
  type Weekday,
} from "@/lib/staff/roster/model";

// Save one person's working shape, effective from a given week onwards.
//
// Owner-only: this is everyone's days and hours.

export const dynamic = "force-dynamic";

const WEEK_KEY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: ShiftKind[] = ["open", "mid", "close"];

type Body = {
  staffId?: string;
  effectiveFrom?: string;
  days?: string[];
  kinds?: string[];
  minUnits?: number;
  maxUnits?: number;
};

export async function PUT(request: Request) {
  if (!(await hasAtLeast("owner"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;

  // Only people who exist in code — name, colour and whether auto may roster
  // them still live there, so an unknown id would resolve to nothing.
  const person = STAFF.find((s) => s.id === body.staffId);
  if (!person) {
    return NextResponse.json({ ok: false, error: "unknown staff" }, { status: 400 });
  }
  if (!body.effectiveFrom || !WEEK_KEY.test(body.effectiveFrom)) {
    return NextResponse.json({ ok: false, error: "bad week" }, { status: 400 });
  }

  const days = (body.days ?? []).filter((d): d is Weekday =>
    WEEKDAYS.includes(d as Weekday),
  );
  const kinds = (body.kinds ?? []).filter((k): k is ShiftKind =>
    KINDS.includes(k as ShiftKind),
  );
  if (kinds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "at least one shift kind" },
      { status: 400 },
    );
  }

  const maxUnits = Math.trunc(Number(body.maxUnits));
  const minUnits = Math.trunc(Number(body.minUnits));
  if (!Number.isFinite(maxUnits) || maxUnits < 0 || maxUnits > 21) {
    return NextResponse.json({ ok: false, error: "bad maxUnits" }, { status: 400 });
  }
  if (!Number.isFinite(minUnits) || minUnits < 0 || minUnits > maxUnits) {
    // A minimum above the maximum makes every roster permanently "under
    // hours" with no way to satisfy it.
    return NextResponse.json(
      { ok: false, error: "minUnits must be between 0 and maxUnits" },
      { status: 400 },
    );
  }

  const { error } = await getSupabaseAdmin()
    .from("staff_profile_overrides")
    .upsert(
      {
        staff_id: person.id,
        effective_from: body.effectiveFrom,
        days,
        kinds,
        min_units: minUnits,
        max_units: maxUnits,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "staff_id,effective_from" },
    );

  if (error) {
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      /could not find the table/i.test(error.message ?? "");
    if (missing) {
      return NextResponse.json({ ok: false, needsMigration: true }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
