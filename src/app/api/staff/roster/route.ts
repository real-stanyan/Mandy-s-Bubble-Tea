import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { hasAtLeast } from "@/lib/staff/auth";
import type { Roster, WeekAvailability } from "@/lib/staff/roster/model";

// Read and write one week's roster.
//
// Owner-only on both verbs: the roster carries everyone's hours and days off,
// so the shared staff code shouldn't reach it even read-only.

export const dynamic = "force-dynamic";

type Row = {
  week_key: string;
  roster: Roster;
  availability: WeekAvailability;
  pinned: string[];
  updated_at: string;
  updated_by: string | null;
};

const WEEK_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isMissingTable(error: { code?: string; message?: string }): boolean {
  // Postgres raises 42P01, but PostgREST usually answers from its schema
  // cache first with PGRST205 — matching only the former meant the setup
  // path never fired.
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /could not find the table/i.test(error.message ?? "");
}

export async function GET(request: Request) {
  if (!(await hasAtLeast("owner"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const week = new URL(request.url).searchParams.get("week") ?? "";
  if (!WEEK_KEY.test(week)) {
    return NextResponse.json({ ok: false, error: "bad week" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("staff_rosters")
    .select("*")
    .eq("week_key", week)
    .maybeSingle();

  if (error) {
    // Migrations here are applied by hand, so a deploy can land before the
    // table exists. Say so plainly instead of failing as if the roster were
    // lost — the page turns that into a setup notice.
    if (isMissingTable(error)) {
      return NextResponse.json({ ok: false, needsMigration: true }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }

  const row = data as Row | null;
  return NextResponse.json({
    ok: true,
    roster: row?.roster ?? {},
    availability: row?.availability ?? {},
    pinned: row?.pinned ?? [],
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  });
}

type PutBody = {
  week?: string;
  roster?: Roster;
  availability?: WeekAvailability;
  pinned?: string[];
  updatedBy?: string;
};

export async function PUT(request: Request) {
  if (!(await hasAtLeast("owner"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as PutBody;
  if (!body.week || !WEEK_KEY.test(body.week)) {
    return NextResponse.json({ ok: false, error: "bad week" }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("staff_rosters")
    .upsert(
      {
        week_key: body.week,
        roster: body.roster ?? {},
        availability: body.availability ?? {},
        pinned: body.pinned ?? [],
        updated_at: new Date().toISOString(),
        updated_by: body.updatedBy ?? null,
      },
      { onConflict: "week_key" },
    )
    .select("updated_at")
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ ok: false, needsMigration: true }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, updatedAt: (data as { updated_at: string }).updated_at });
}
