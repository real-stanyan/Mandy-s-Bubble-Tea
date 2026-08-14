import {
  SHOP_TIMEZONE,
  SUFFICIENCY_LABEL,
  sufficiencyNeedingAction,
  type StockReport,
} from "./stocklist";

// Renders the stock check into the email that goes to the shop inbox.
//
// The subject line carries the whole headline, because that is all anyone
// reads on a phone lock screen: how many things need ordering, and whether
// anything was left uncounted.

export function formatShopDate(now: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: SHOP_TIMEZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(now);
}

export function subjectFor(report: StockReport, now: Date): string {
  const date = formatShopDate(now);
  const parts: string[] = [];
  // Cups and straws count toward "to order" even though they carry no
  // number: running out of cups closes the shop faster than running out of
  // any syrup on the list, and a subject line reading "nothing to order" on
  // a day the cups are short would be the most expensive sentence here.
  const short = sufficiencyNeedingAction(report).length;
  const toOrder = report.reorder.length + short;
  parts.push(toOrder === 0 ? "nothing to order" : `${toOrder} to order`);
  if (report.isOrderDay && report.weekly.length > 0) {
    parts.push(`${report.weekly.length} weekly`);
  }
  // Uncounted items ride in the subject because they are the failure mode
  // that silently produces a short order — an all-clear that only covered
  // half the shelves looks identical to a real all-clear.
  if (report.missing.length > 0) parts.push(`${report.missing.length} NOT COUNTED`);
  return `Stock check ${date} — ${parts.join(", ")}`;
}

function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

function section(title: string, rows: string[]): string {
  if (rows.length === 0) return "";
  return `<h3 style="margin:24px 0 8px;font:600 15px system-ui,sans-serif">${title}</h3>
<table style="border-collapse:collapse;width:100%;font:14px system-ui,sans-serif">${rows.join("")}</table>`;
}

function row(left: string, right: string, accent?: string): string {
  return `<tr>
<td style="padding:6px 8px;border-bottom:1px solid #eee${accent ? `;border-left:3px solid ${accent}` : ""}">${left}</td>
<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums">${right}</td>
</tr>`;
}

export function renderReportHtml(
  report: StockReport,
  now: Date,
  countedBy: string | null,
): string {
  const date = formatShopDate(now);

  const header = `<p style="font:14px system-ui,sans-serif;color:#555;margin:0 0 4px">
Mandy's Bubble Tea · stock check · ${date}${countedBy ? ` · counted by ${escapeHtml(countedBy)}` : ""}
</p>`;

  const needAction = sufficiencyNeedingAction(report);
  const toOrder = report.reorder.length + needAction.length;
  const headline =
    toOrder === 0
      ? `<p style="font:600 18px system-ui,sans-serif;color:#166534;margin:12px 0">Nothing below threshold.</p>`
      : `<p style="font:600 18px system-ui,sans-serif;color:#b91c1c;margin:12px 0">${toOrder} item${toOrder === 1 ? "" : "s"} to order.</p>`;

  // Its own section, above the numbered shelves: cups and straws are the two
  // things that stop the counter entirely, and they are answered in words.
  const packaging = section(
    "Cups & straws",
    report.sufficiency.map((s) =>
      row(
        s.level === "enough"
          ? escapeHtml(s.item.name)
          : `<b>${escapeHtml(s.item.name)}</b>`,
        SUFFICIENCY_LABEL[s.level],
        s.level === "short" ? "#b91c1c" : s.level === "maybe" ? "#c2410c" : undefined,
      ),
    ),
  );

  const reorder = section(
    "Order these",
    report.reorder.map((r) =>
      row(
        `<b>${escapeHtml(r.item.name)}</b>`,
        `${qty(r.qty)} left · reorder at ${qty(r.threshold)}`,
        "#b91c1c",
      ),
    ),
  );

  const weekly = report.isOrderDay
    ? section(
        "Weekly items (Tuesday report)",
        report.weekly.map((r) => row(escapeHtml(r.item.name), `${qty(r.qty)} left`, "#2563eb")),
      )
    : "";

  const missing = section(
    "Not counted",
    report.missing.map((i) =>
      row(escapeHtml(i.name), "<i>left blank</i>", "#d97706"),
    ),
  );

  const ok = section(
    "Counted, fine",
    report.ok.map((r) => row(escapeHtml(r.item.name), qty(r.qty))),
  );

  // See the text version: a count, not a list.
  const notDue =
    report.notDue.length > 0
      ? `<p style="margin:16px 0 0;color:#71717a;font-size:12px">${report.notDue.length} weekly items not due today — counted Tuesdays.</p>`
      : "";

  return `<div style="max-width:640px;margin:0 auto;padding:16px">
${header}${headline}${packaging}${reorder}${weekly}${missing}${ok}${notDue}
</div>`;
}

/** Plain-text fallback — some phone mail clients still prefer it. */
export function renderReportText(
  report: StockReport,
  now: Date,
  countedBy: string | null,
): string {
  const lines: string[] = [];
  lines.push(`Mandy's Bubble Tea — stock check ${formatShopDate(now)}`);
  if (countedBy) lines.push(`Counted by: ${countedBy}`);
  lines.push("");

  const needAction = sufficiencyNeedingAction(report);

  if (report.sufficiency.length > 0) {
    lines.push("CUPS & STRAWS:");
    for (const s of report.sufficiency) {
      lines.push(`  - ${s.item.name}: ${SUFFICIENCY_LABEL[s.level]}`);
    }
    lines.push("");
  }

  if (report.reorder.length === 0 && needAction.length === 0) {
    lines.push("Nothing below threshold.");
  } else {
    lines.push(`ORDER THESE (${report.reorder.length + needAction.length}):`);
    for (const s of needAction) {
      lines.push(`  - ${s.item.name}: ${SUFFICIENCY_LABEL[s.level]}`);
    }
    for (const r of report.reorder) {
      lines.push(`  - ${r.item.name}: ${qty(r.qty)} left (reorder at ${qty(r.threshold)})`);
    }
  }

  if (report.isOrderDay && report.weekly.length > 0) {
    lines.push("", "WEEKLY ITEMS (Tuesday report):");
    for (const r of report.weekly) lines.push(`  - ${r.item.name}: ${qty(r.qty)} left`);
  }

  if (report.missing.length > 0) {
    lines.push("", `NOT COUNTED (${report.missing.length}):`);
    for (const i of report.missing) lines.push(`  - ${i.name}`);
  }

  // One line, not a list: these were not asked for today, so naming all of
  // them would recreate the noise that moving them off the daily count
  // removed. It exists so the absence reads as by-design, not as a gap.
  if (report.notDue.length > 0) {
    lines.push(
      "",
      `(${report.notDue.length} weekly items not due today — counted Tuesdays.)`,
    );
  }

  if (report.ok.length > 0) {
    lines.push("", "Counted, fine:");
    for (const r of report.ok) lines.push(`  - ${r.item.name}: ${qty(r.qty)}`);
  }

  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
