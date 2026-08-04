import { notFound } from "next/navigation";
import { hasAtLeast } from "@/lib/staff/auth";
import { weekKeyFor } from "@/lib/staff/roster/week";
import { RosterClient } from "./roster-client";

export const dynamic = "force-dynamic";

export default async function StaffRosterPage() {
  // Owner-only: the roster carries everyone's hours and days off, which the
  // shared staff code shouldn't open. 404 rather than a redirect, so the page
  // doesn't confirm to a staff-code holder that there's something here.
  if (!(await hasAtLeast("owner"))) notFound();

  // Week resolved on the server so "this week" follows shop time rather than
  // the viewer's device clock.
  return <RosterClient initialWeekKey={weekKeyFor()} />;
}
