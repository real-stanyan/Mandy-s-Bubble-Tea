import { NextResponse } from "next/server";
import { getResendClient, COMPLAINT_TO_EMAIL } from "@/lib/email/resend";
import { hasAtLeast } from "@/lib/staff/auth";
import { ALL_ITEMS, buildReport, type Counted } from "@/lib/staff/stocklist";
import {
  renderReportHtml,
  renderReportText,
  subjectFor,
} from "@/lib/staff/report-email";

export const dynamic = "force-dynamic";

const TO = process.env.STOCK_REPORT_TO ?? COMPLAINT_TO_EMAIL;
const FROM =
  process.env.STOCK_REPORT_FROM ?? "Mandy's Stock Check <noreply@mandybubbletea.com>";

type Body = {
  /** item id -> raw input string. Blank/absent means "not counted". */
  counts?: Record<string, string>;
  countedBy?: string;
};

export async function POST(request: Request) {
  // The page is gated, but the route is reachable directly — without this a
  // stranger could post a fabricated stock report into the shop inbox.
  if (!(await hasAtLeast("staff"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const raw = body.counts ?? {};

  // Built from ALL_ITEMS, not from the submitted keys: an item the browser
  // never sent (a cached page after the list changed, a field that failed to
  // render) has to land in "not counted" rather than vanish from the report.
  const counts: Counted[] = ALL_ITEMS.map((item) => {
    const value = raw[item.id];
    if (value == null || value.trim() === "") return { item, qty: null };
    const parsed = Number(value);
    return { item, qty: Number.isFinite(parsed) ? parsed : null };
  });

  const now = new Date();
  const report = buildReport(counts, now);
  const countedBy = body.countedBy?.trim() || null;

  try {
    const { error } = await getResendClient().emails.send({
      from: FROM,
      to: [TO],
      subject: subjectFor(report, now),
      html: renderReportHtml(report, now, countedBy),
      text: renderReportText(report, now, countedBy),
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, emailed: true, report: serialise(report) });
  } catch (err) {
    // Hand the report back regardless so the count isn't lost, but say plainly
    // that nothing was emailed. A success screen for a report nobody received
    // is the one outcome that quietly causes a missed order.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ok: true,
      emailed: false,
      emailError: message,
      report: serialise(report),
    });
  }
}

function serialise(report: ReturnType<typeof buildReport>) {
  return {
    isOrderDay: report.isOrderDay,
    reorder: report.reorder.map((r) => ({
      name: r.item.name,
      qty: r.qty,
      threshold: r.threshold,
    })),
    weekly: report.weekly.map((r) => ({ name: r.item.name, qty: r.qty })),
    missing: report.missing.map((i) => i.name),
    okCount: report.ok.length,
  };
}
