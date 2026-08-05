import { notFound } from "next/navigation";
import { hasAtLeast } from "@/lib/staff/auth";
import { weekKeyFor } from "@/lib/staff/roster/week";
import {
  EMPTY_WEEK,
  loadPreviousSundayClosers,
  loadWeek,
} from "@/lib/staff/roster/store";
import { RosterClient } from "./roster-client";

export const dynamic = "force-dynamic";

const WEEK_KEY = /^\d{4}-\d{2}-\d{2}$/;

export default async function StaffRosterPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  // Owner-only: the roster carries everyone's hours and days off, which the
  // shared staff code shouldn't open. 404 rather than a redirect, so the page
  // doesn't confirm to a staff-code holder that there's something here.
  if (!(await hasAtLeast("owner"))) notFound();

  // The week lives in the URL so switching weeks is a normal navigation that
  // re-runs this loader — and so a particular week can be linked or bookmarked.
  // Defaults to shop time rather than the viewer's device clock.
  const { week } = await searchParams;
  const weekKey = week && WEEK_KEY.test(week) ? week : weekKeyFor();

  // Monday's "did they close last night?" answer lives in the previous week,
  // which a per-week grid can't see — so it's loaded alongside.
  const [result, previousSundayClosers] = await Promise.all([
    loadWeek(weekKey),
    loadPreviousSundayClosers(weekKey),
  ]);

  if (result.status === "needs-migration") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold">Roster</h1>
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Setup needed.</b> Run{" "}
          <code>scripts/migrations/006_staff_rosters.sql</code> in the Supabase
          SQL editor, then reload. Until then there is nowhere to save a roster,
          and anything built here would be lost on the next page load.
        </div>
      </div>
    );
  }

  return (
    <RosterClient
      weekKey={weekKey}
      initial={result.status === "ok" ? result.week : EMPTY_WEEK}
      loadError={result.status === "error" ? result.message : null}
      previousSundayClosers={previousSundayClosers}
    />
  );
}
