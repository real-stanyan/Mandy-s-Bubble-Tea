import { NextResponse } from "next/server";
import { COMPLAINT_TO_EMAIL } from "@/lib/email/resend";
import { sendTransactionalEmail } from "@/lib/email/send";
import { hasAtLeast } from "@/lib/staff/auth";
import { writeLastCount } from "@/lib/staff/stock-history-store";
import { recordShopCountFromCheck } from "@/lib/staff/inventory-store";
import {
  applyThresholds,
  buildReport,
  isSufficiency,
  type Counted,
} from "@/lib/staff/stocklist";
import { readThresholds } from "@/lib/staff/threshold-store";
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
  // The edited thresholds, not the defaults. Without this the form would show
  // a changed number while the report still flagged against the original —
  // the edit would look applied and change nothing that matters.
  const overrides = await readThresholds();
  const items = applyThresholds(overrides).flatMap((c) => c.items);

  const counts: Counted[] = items.map((item) => {
    const value = raw[item.id];
    if (value == null || value.trim() === "") return { item, qty: null, level: null };
    if (item.rule.kind === "sufficiency") {
      // Anything that is not one of the three answers is treated as no
      // answer. A stray value here would otherwise be reported as a state
      // the shop does not have.
      const v = value.trim();
      return { item, qty: null, level: isSufficiency(v) ? v : null };
    }
    const parsed = Number(value);
    return { item, qty: Number.isFinite(parsed) ? parsed : null };
  });

  const now = new Date();
  const report = buildReport(counts, now);
  const countedBy = body.countedBy?.trim() || null;

  // Recorded before the send, and independently of it: the numbers staff
  // counted are worth keeping whatever the mail provider does — that is the
  // lesson of the 69-day Resend outage (#130/#132), where every complaint in
  // the window was lost because the text only ever lived in an email. A failed
  // write is logged inside and never blocks the report.
  await writeLastCount(raw, now);
  // The same numbers feed the warehouse inventory: consecutive counts are how
  // it measures what the shop uses per day (see lib/staff/inventory.ts).
  await recordShopCountFromCheck(raw, now);

  const outcome = await sendTransactionalEmail("stock-check", {
    from: FROM,
    to: [TO],
    subject: subjectFor(report, now),
    html: renderReportHtml(report, now, countedBy),
    text: renderReportText(report, now, countedBy),
  });

  // Hand the report back either way so the count isn't lost, but say plainly
  // when nothing was emailed. A success screen for a report nobody received is
  // the one outcome that quietly causes a missed order.
  return NextResponse.json({
    ok: true,
    emailed: outcome.sent,
    ...(outcome.sent ? {} : { emailError: outcome.reason }),
    report: serialise(report),
  });
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
