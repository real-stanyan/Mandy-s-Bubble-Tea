"use client";
import { useMemo, useState } from "react";
import type { FinanceView } from "@/lib/staff/finance-store";
import {
  addDaysYmd,
  aggregate,
  type EntryKind,
  type Granularity,
  type MoneyEntry,
  type PeriodPoint,
  type RecurringCost,
} from "@/lib/staff/finance";

/**
 * Income against cost, by day / week / month.
 *
 * One chart, one money axis: cost as bars, income as a line over them, so
 * the gap between the two IS the margin and reads without a second scale.
 * Everything below the chart is the same numbers as a table, and the
 * ledger where Stan types wages, bills and the rent.
 */

const RANGES = [
  { key: "4w", label: "4 weeks", days: 27 },
  { key: "13w", label: "13 weeks", days: 90 },
  { key: "26w", label: "26 weeks", days: 181 },
] as const;

// Two series → two categorical slots from the validated default palette
// (blue / orange), light and dark steps. Text never wears these.
const C = {
  income: "#2a78d6",
  incomeDark: "#3987e5",
  cost: "#eb6834",
  costDark: "#d95926",
};

const KIND_LABEL: Record<EntryKind, string> = {
  doordash: "DoorDash payout",
  electricity: "Electricity",
  wages: "Wages",
  "other-cost": "Other cost",
  "other-income": "Other income",
};

const money = (n: number, digits = 0) =>
  "$" + n.toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** part as a percentage of whole — one decimal under 10%, none above. */
const pct = (part: number, whole: number) => {
  if (!(whole > 0)) return "—";
  const r = (part / whole) * 100;
  return `${r.toFixed(Math.abs(r) < 10 ? 1 : 0)}%`;
};

export function FinanceClient({ initial }: { initial: FinanceView }) {
  const [view, setView] = useState(initial);
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]["key"]>("13w");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [recurring, setRecurring] = useState<Array<{ id: string; name: string; amount: string; per: "week" | "month" }>>(() =>
    initial.finance.recurring.map((r) => ({ ...r, amount: String(r.amount) })),
  );
  const [form, setForm] = useState({ kind: "wages" as EntryKind, from: "", to: "", amount: "", note: "", ref: "" });
  const [ddText, setDdText] = useState("");

  const periods = useMemo(() => aggregate(view.points, granularity), [view.points, granularity]);
  const totals = useMemo(() => {
    const t = { income: 0, cost: 0, square: 0, doordash: 0, ingredients: 0, packaging: 0, fixed: 0, wages: 0, electricity: 0, otherCost: 0, otherIncome: 0 };
    for (const p of periods) for (const k of Object.keys(t) as Array<keyof typeof t>) t[k] += p[k];
    return t;
  }, [periods]);

  async function load(range: (typeof RANGES)[number]) {
    setBusy("range");
    setNotice(null);
    try {
      const to = view.today;
      const from = addDaysYmd(to, -range.days);
      const res = await fetch(`/api/staff/finance?from=${from}&to=${to}`);
      const j = (await res.json()) as { ok: boolean; view?: FinanceView; error?: string };
      if (!j.ok || !j.view) throw new Error(j.error ?? String(res.status));
      setView(j.view);
      setRangeKey(range.key);
    } catch (e) {
      setNotice({ tone: "err", text: `Could not load: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  }

  async function post(body: Record<string, unknown>, label: string): Promise<{ imported?: { found: number } } | null> {
    setBusy(label);
    setNotice(null);
    try {
      const res = await fetch("/api/staff/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, range: { from: view.from, to: view.to } }),
      });
      const j = (await res.json()) as { ok: boolean; view?: FinanceView; error?: string; imported?: { found: number } };
      if (!j.ok || !j.view) {
        setNotice({ tone: "err", text: j.error === "forbidden" ? "Owner passcode required." : `Not saved (${j.error ?? res.status}).` });
        return null;
      }
      setView(j.view);
      setRecurring(j.view.finance.recurring.map((r) => ({ ...r, amount: String(r.amount) })));
      return j;
    } catch (e) {
      setNotice({ tone: "err", text: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  const recurringDirty =
    JSON.stringify(recurring.map((r) => [r.id, r.name, Number(r.amount), r.per])) !==
    JSON.stringify(view.finance.recurring.map((r) => [r.id, r.name, r.amount, r.per]));

  async function saveRecurring() {
    const items: RecurringCost[] = recurring
      .filter((r) => r.name.trim() !== "")
      .map((r) => ({ id: r.id, name: r.name.trim(), amount: Number(r.amount) || 0, per: r.per }));
    if (await post({ action: "set-recurring", items }, "recurring")) {
      setNotice({ tone: "ok", text: "Fixed costs saved." });
    }
  }

  async function addEntry() {
    const amount = Number(form.amount);
    if (!form.from || !Number.isFinite(amount) || amount <= 0) {
      setNotice({ tone: "err", text: "Pick a start date and an amount." });
      return;
    }
    const to = form.to || (form.kind === "wages" ? addDaysYmd(form.from, 6) : form.from);
    if (await post({ action: "add-entry", kind: form.kind, from: form.from, to, amount, note: form.note, ref: form.ref }, "add")) {
      setForm((f) => ({ ...f, amount: "", note: "", ref: "" }));
      setNotice({ tone: "ok", text: `${KIND_LABEL[form.kind]} added.` });
    }
  }

  async function importDoorDash() {
    if (ddText.trim() === "") return;
    const j = await post({ action: "import-doordash", text: ddText }, "dd");
    if (j) {
      setDdText("");
      setNotice({
        tone: j.imported?.found ? "ok" : "err",
        text: j.imported?.found ? `Found ${j.imported.found} DoorDash payout${j.imported.found === 1 ? "" : "s"}.` : "No DoorDash payouts found in that text.",
      });
    }
  }

  async function deleteEntry(e: MoneyEntry) {
    if (!window.confirm(`Remove ${KIND_LABEL[e.kind]} ${money(e.amount, 2)} (${e.from}${e.to !== e.from ? ` – ${e.to}` : ""})?`)) return;
    await post({ action: "delete-entry", id: e.id }, `del-${e.id}`);
  }

  const input =
    "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900";
  const pill = (on: boolean) =>
    `rounded-full px-3 py-1.5 text-sm font-medium ${on ? "bg-[#3B82C4] text-white" : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"}`;

  const marginPct = totals.income > 0 ? ((totals.income - totals.cost) / totals.income) * 100 : null;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Finance</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {view.from} → {view.to} · Square + DoorDash against ingredients, packaging, rent, wages and bills.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button key={r.key} type="button" disabled={busy !== null} onClick={() => load(r)} className={pill(rangeKey === r.key)}>
              {r.label}
            </button>
          ))}
          <span className="mx-1 hidden w-px bg-zinc-200 sm:block dark:bg-zinc-800" />
          {(["day", "week", "month"] as Granularity[]).map((g) => (
            <button key={g} type="button" onClick={() => setGranularity(g)} className={pill(granularity === g)}>
              {g[0].toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <p className={`mt-4 rounded-lg border p-3 text-sm ${notice.tone === "ok" ? "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100" : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"}`}>
          {notice.text}
        </p>
      )}

      {/* ── Headline ─────────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Income" value={money(totals.income)} sub={`Square ${pct(totals.square, totals.income)} · DoorDash ${pct(totals.doordash, totals.income)}`} />
        <Tile label="Cost" value={money(totals.cost)} sub={`${pct(totals.cost, totals.income)} of income · ingredients ${pct(totals.ingredients + totals.packaging, totals.income)}`} />
        <Tile label="Margin" value={money(totals.income - totals.cost)} sub={marginPct == null ? "—" : `${marginPct.toFixed(marginPct < 10 ? 1 : 0)}% of income`} />
        <Tile label="Wages + bills" value={money(totals.wages + totals.electricity + totals.otherCost)} sub={`wages ${pct(totals.wages, totals.income)} · power ${pct(totals.electricity, totals.income)} of income`} />
      </div>
      <ShareBar totals={totals} />
      {view.firstConsumptionDay && view.firstConsumptionDay > view.from && (
        <p className="mt-2 text-xs text-zinc-500">
          Ingredient cost is measured from stock counts, which start {view.firstConsumptionDay}; earlier days show only fixed costs, wages and bills.
        </p>
      )}

      {/* ── Chart ────────────────────────────────────────────────── */}
      <section className="mt-6 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C.cost }} /> Cost
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: C.income }} /> Income
            </span>
          </div>
          <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs text-zinc-500 underline">
            {showTable ? "hide table" : "show table"}
          </button>
        </div>
        <Chart periods={periods} hover={hover} onHover={setHover} granularity={granularity} />
      </section>

      {showTable && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                {["Period", "Square", "DoorDash", "Ingredients", "Packaging", "Fixed", "Wages", "Power", "Other", "Cost %", "Margin", "Margin %"].map((h) => (
                  <th key={h} className={`px-3 py-2 ${h === "Period" ? "" : "text-right"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...periods].reverse().map((p) => (
                <tr key={p.key} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-3 py-1.5">{p.label}{p.days > 1 && granularity !== "day" ? <span className="text-zinc-400"> · {p.days}d</span> : null}</td>
                  <td className="px-3 py-1.5 text-right">{money(p.square)}</td>
                  <td className="px-3 py-1.5 text-right">{money(p.doordash)}</td>
                  <td className="px-3 py-1.5 text-right">{money(p.ingredients)}</td>
                  <td className="px-3 py-1.5 text-right">{money(p.packaging)}</td>
                  <td className="px-3 py-1.5 text-right">{money(p.fixed)}</td>
                  <td className="px-3 py-1.5 text-right">{money(p.wages)}</td>
                  <td className="px-3 py-1.5 text-right">{money(p.electricity)}</td>
                  <td className="px-3 py-1.5 text-right">{money(p.otherCost - p.otherIncome)}</td>
                  <td className="px-3 py-1.5 text-right text-zinc-500">{pct(p.cost, p.income)}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${p.margin < 0 ? "text-red-600" : ""}`}>{money(p.margin)}</td>
                  <td className={`px-3 py-1.5 text-right ${p.margin < 0 ? "text-red-600" : "text-zinc-500"}`}>{pct(p.margin, p.income)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Ledger ───────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Add to the ledger</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Wages by week (Monday start, 7 days filled in), a power bill by its billing period, anything else with a date range.
          Each amount is spread evenly across its days.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
          <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as EntryKind }))} className={input} aria-label="Kind">
            {(Object.keys(KIND_LABEL) as EntryKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <input type="date" value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} className={input} aria-label="From" />
          <input type="date" value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} className={input} aria-label="To (optional)" />
          <input inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="amount" className={`${input} text-right`} aria-label="Amount" />
          <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="note" className={input} aria-label="Note" />
          <button type="button" onClick={addEntry} disabled={busy !== null} className="rounded-lg bg-[#3B82C4] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === "add" ? "Adding…" : "Add"}
          </button>
        </div>

        <h3 className="mt-6 text-sm font-semibold">Fixed costs</h3>
        <p className="mt-1 text-xs text-zinc-500">Charged to every day as a share of the week or the month. Edit, add a row, or clear a name to drop one.</p>
        <ul className="mt-2 space-y-2">
          {recurring.map((r, i) => (
            <li key={r.id} className="grid grid-cols-[1fr_6rem_6rem] gap-2">
              <input value={r.name} onChange={(e) => setRecurring((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={input} aria-label="Fixed cost name" />
              <input inputMode="decimal" value={r.amount} onChange={(e) => setRecurring((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className={`${input} text-right`} aria-label="Amount" />
              <select value={r.per} onChange={(e) => setRecurring((p) => p.map((x, j) => (j === i ? { ...x, per: e.target.value as "week" | "month" } : x)))} className={input} aria-label="Per">
                <option value="week">per week</option>
                <option value="month">per month</option>
              </select>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => setRecurring((p) => [...p, { id: `rec-${Date.now().toString(36)}`, name: "", amount: "", per: "month" }])} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
            + row
          </button>
          <button type="button" onClick={saveRecurring} disabled={busy !== null || !recurringDirty} className="rounded-lg bg-[#3B82C4] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy === "recurring" ? "Saving…" : "Save fixed costs"}
          </button>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold">Import DoorDash payout emails</summary>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Paste the text of one or many &ldquo;Your DoorDash payment for …&rdquo; emails. The period in the subject and the
            amount in the body are picked out; re-pasting the same email updates rather than doubles.
          </p>
          <textarea value={ddText} onChange={(e) => setDdText(e.target.value)} rows={6} className="mt-2 w-full rounded-lg border border-zinc-300 p-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900" />
          <button type="button" onClick={importDoorDash} disabled={busy !== null || ddText.trim() === ""} className="mt-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-zinc-700">
            {busy === "dd" ? "Importing…" : "Import"}
          </button>
        </details>

        <h3 className="mt-6 text-sm font-semibold">Entries in this range</h3>
        <ul className="mt-1 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {view.finance.entries
            .filter((e) => e.to >= view.from && e.from <= view.to)
            .slice()
            .reverse()
            .map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-1.5">
                <span className="w-32 shrink-0 text-zinc-500">{e.from}{e.to !== e.from ? ` – ${e.to}` : ""}</span>
                <span className="min-w-0 flex-1 truncate">
                  {KIND_LABEL[e.kind]}
                  {e.note ? <span className="text-zinc-500"> · {e.note}</span> : null}
                </span>
                <span className="tabular-nums">{money(e.amount, 2)}</span>
                <button type="button" onClick={() => deleteEntry(e)} disabled={busy !== null} aria-label="Remove" className="grid h-7 w-7 place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800">×</button>
              </li>
            ))}
          {view.finance.entries.filter((e) => e.to >= view.from && e.from <= view.to).length === 0 && (
            <li className="py-2 text-zinc-500">Nothing yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

/** Every dollar of income in the range, split into what it paid for and what was left.
 *  Cost categories are steps of the one cost hue (same job, parts of a whole);
 *  the margin is the income blue. */
function ShareBar({
  totals,
}: {
  totals: { income: number; cost: number; ingredients: number; packaging: number; fixed: number; wages: number; electricity: number; otherCost: number };
}) {
  if (!(totals.income > 0)) return null;
  const parts = [
    { key: "Ingredients", v: totals.ingredients, op: 1 },
    { key: "Packaging", v: totals.packaging, op: 0.78 },
    { key: "Fixed", v: totals.fixed, op: 0.6 },
    { key: "Wages", v: totals.wages, op: 0.45 },
    { key: "Power", v: totals.electricity, op: 0.33 },
    { key: "Other", v: totals.otherCost, op: 0.22 },
  ].filter((p) => p.v > 0);
  const margin = totals.income - totals.cost;
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / totals.income) * 100))}%`;
  return (
    <div className="mt-3">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="img" aria-label="Share of income by cost category and margin">
        {parts.map((p) => (
          <div key={p.key} title={`${p.key} ${pct(p.v, totals.income)}`} style={{ width: w(p.v), background: C.cost, opacity: p.op }} />
        ))}
        {margin > 0 && <div title={`Margin ${pct(margin, totals.income)}`} style={{ width: w(margin), background: C.income }} />}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5 tabular-nums">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: C.cost, opacity: p.op }} />
            {p.key} {pct(p.v, totals.income)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: C.income }} />
          <span className={margin < 0 ? "text-red-600" : ""}>Margin {pct(margin, totals.income)}</span>
        </span>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 truncate text-xs text-zinc-500">{sub}</div>
    </div>
  );
}

/** Cost bars, income line, one money axis. Pure SVG so it needs no library. */
function Chart({
  periods,
  hover,
  onHover,
  granularity,
}: {
  periods: PeriodPoint[];
  hover: number | null;
  onHover: (i: number | null) => void;
  granularity: Granularity;
}) {
  const W = 720;
  const H = 260;
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = periods.length;
  if (n === 0) return <p className="py-10 text-center text-sm text-zinc-500">No data in this range.</p>;
  const max = Math.max(1, ...periods.map((p) => Math.max(p.cost, p.income)));
  const nice = niceMax(max);
  const y = (v: number) => pad.t + ih - (v / nice) * ih;
  const slot = iw / n;
  const barW = Math.max(2, Math.min(28, slot * 0.6));
  const x = (i: number) => pad.l + slot * i + slot / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);
  const labelEvery = Math.max(1, Math.ceil(n / (granularity === "day" ? 7 : 8)));
  const line = periods.map((p, i) => `${x(i).toFixed(1)},${y(p.income).toFixed(1)}`).join(" ");
  const h = hover != null && hover < n ? periods[hover] : null;

  return (
    <div className="relative mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Cost (bars) and income (line) per period"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.floor((px - pad.l) / slot);
          onHover(i >= 0 && i < n ? i : null);
        }}
        onMouseLeave={() => onHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.55}>
              {t >= 1000 ? `${(t / 1000).toFixed(t % 1000 ? 1 : 0)}k` : t.toFixed(0)}
            </text>
          </g>
        ))}
        {periods.map((p, i) => (
          <rect
            key={p.key}
            x={x(i) - barW / 2}
            y={y(p.cost)}
            width={barW}
            height={Math.max(0, pad.t + ih - y(p.cost))}
            rx={3}
            fill={C.cost}
            fillOpacity={hover == null || hover === i ? 0.9 : 0.45}
          />
        ))}
        <polyline points={line} fill="none" stroke={C.income} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {periods.map((p, i) => (
          <circle key={p.key} cx={x(i)} cy={y(p.income)} r={hover === i ? 5 : 3.5} fill={C.income} stroke="#fff" strokeWidth={1.5} />
        ))}
        {periods.map((p, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={p.key} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.6}>
              {p.label.replace(/^wk /, "")}
            </text>
          ) : null,
        )}
        {h && <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={pad.t + ih} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" />}
      </svg>
      {h && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs shadow dark:border-zinc-700 dark:bg-zinc-900/95">
          <div className="font-semibold">{h.label}{h.days > 1 && granularity !== "day" ? ` · ${h.days} days` : ""}</div>
          <div className="mt-1 tabular-nums">Income {money(h.income)} <span className="text-zinc-500">(Square {money(h.square)}, DoorDash {money(h.doordash)})</span></div>
          <div className="tabular-nums">Cost {money(h.cost)} · {pct(h.cost, h.income)} of income <span className="text-zinc-500">(ingredients {money(h.ingredients + h.packaging)}, fixed {money(h.fixed)}, wages {money(h.wages)}, power {money(h.electricity)})</span></div>
          <div className={`tabular-nums font-semibold ${h.margin < 0 ? "text-red-600" : ""}`}>Margin {money(h.margin)} · {pct(h.margin, h.income)}</div>
        </div>
      )}
    </div>
  );
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * p;
}
