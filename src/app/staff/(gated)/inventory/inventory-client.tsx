"use client";
import { useMemo, useState } from "react";
import type { InventoryRow, InventoryView, PickupSuggestion } from "@/lib/staff/inventory";

/**
 * The warehouse page: what to carry to the shop today, what is running low
 * in storage, and the inventory itself with every number editable.
 *
 * Three sections in the order Stan uses them in the morning — pickup list
 * first, because that is the decision the page exists for; alerts second,
 * because a low warehouse changes what he orders this week; the full table
 * last, for the occasional edit after a delivery.
 *
 * Every edit is a draft until Save. The table is long, a phone keyboard is
 * clumsy, and a save on every keystroke would race itself.
 */

type Draft = { qty: string; threshold: string; unit: string; usageOverride: string; unitCost: string };

type ImportSummary = { days: number; added: number; unknown: string[]; ambiguous: string[] };

const REASON_LABEL: Record<PickupSuggestion["reason"], string> = {
  covered: "shop is covered",
  topup: "top-up",
  "no-usage": "no usage figure yet",
  "no-shop-count": "not on the count sheet",
  "warehouse-empty": "warehouse empty",
  "warehouse-short": "all the warehouse has",
};

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return String(r);
}

function draftOf(rows: InventoryRow[]): Record<string, Draft> {
  const out: Record<string, Draft> = {};
  for (const r of rows) {
    out[r.id] = {
      qty: r.qty == null ? "" : String(r.qty),
      threshold: r.threshold == null ? "" : String(r.threshold),
      unit: r.unit,
      usageOverride: r.usageOverride == null ? "" : String(r.usageOverride),
      unitCost: r.unitCost == null ? "" : String(r.unitCost),
    };
  }
  return out;
}

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function InventoryClient({ initial }: { initial: InventoryView }) {
  const [view, setView] = useState<InventoryView>(initial);
  const [draft, setDraft] = useState<Record<string, Draft>>(() => draftOf(initial.rows));
  const [pick, setPick] = useState<Record<string, string>>({});
  const [pickBy, setPickBy] = useState("");
  const [showAllPick, setShowAllPick] = useState(false);
  const [coverDays, setCoverDays] = useState(String(initial.coverDays));
  const [newItem, setNewItem] = useState({ name: "", category: "", unit: "", qty: "", threshold: "" });
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [peekStale, setPeekStale] = useState(false);
  const [shopOnlyOpen, setShopOnlyOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const categories = useMemo(() => {
    const order: string[] = [];
    const byCat = new Map<string, InventoryRow[]>();
    for (const r of view.rows) {
      if (!r.inWarehouse) continue;
      if (!byCat.has(r.category)) {
        byCat.set(r.category, []);
        order.push(r.category);
      }
      byCat.get(r.category)!.push(r);
    }
    return order.map((name) => ({ name, rows: byCat.get(name)! }));
  }, [view.rows]);

  const low = view.rows.filter((r) => r.low);
  const shopOnlyRows = view.rows.filter((r) => !r.inWarehouse);
  // Warehouse items first, then what has to be bought — the run goes past
  // the warehouse before the shops.
  const byKind = (a: InventoryRow, b: InventoryRow) =>
    a.kind === b.kind ? 0 : a.kind === "warehouse" ? -1 : 1;
  const suggested = view.rows.filter((r) => r.suggestion.bring > 0).sort(byKind);
  const pickRows = showAllPick ? view.rows.filter((r) => r.hasShopCount).sort(byKind) : suggested;
  const pickTotals = {
    warehouse: suggested.filter((r) => r.kind === "warehouse").length,
    buy: suggested.filter((r) => r.kind === "buy").length,
  };
  // The list is computed from today's count, so it waits for it. Stan can
  // peek at the previous count's answer, clearly labelled as such.
  const listReady = view.countedToday || peekStale;

  const dirtyIds = view.rows.filter((r) => {
    const d = draft[r.id];
    if (!d) return false;
    return (
      numOrNull(d.qty) !== r.qty ||
      numOrNull(d.threshold) !== r.threshold ||
      numOrNull(d.usageOverride) !== r.usageOverride ||
      numOrNull(d.unitCost) !== r.unitCost ||
      d.unit.trim() !== r.unit
    );
  });

  function pickQty(r: InventoryRow): number {
    const raw = pick[r.id];
    if (raw == null) return r.suggestion.bring;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  /** POST one action; on success swap in the fresh view. Returns the JSON so
   *  callers that want more than the view (the import summary) can read it. */
  async function call<T extends { ok: boolean; view?: InventoryView; error?: string }>(
    body: unknown,
    label: string,
  ): Promise<T | null> {
    setBusy(label);
    setNotice(null);
    try {
      const res = await fetch("/api/staff/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as T;
      if (!j.ok || !j.view) {
        setNotice({
          tone: "err",
          text: j.error === "forbidden" ? "Owner passcode required." : `Not saved (${j.error ?? res.status}).`,
        });
        return null;
      }
      setView(j.view);
      setDraft(draftOf(j.view.rows));
      return j;
    } catch (e) {
      setNotice({ tone: "err", text: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveEdits() {
    const items = dirtyIds.map((r) => {
      const d = draft[r.id];
      return {
        id: r.id,
        qty: numOrNull(d.qty),
        threshold: numOrNull(d.threshold),
        usageOverride: numOrNull(d.usageOverride),
        unitCost: numOrNull(d.unitCost),
        unit: d.unit,
      };
    });
    if (items.length === 0) return;
    if (await call({ action: "patch-items", items }, "save")) {
      setNotice({ tone: "ok", text: `Saved ${items.length} item${items.length === 1 ? "" : "s"}.` });
    }
  }

  async function confirmPickup() {
    const lines = pickRows.map((r) => ({ id: r.id, qty: pickQty(r) })).filter((l) => l.qty > 0);
    if (lines.length === 0) {
      setNotice({ tone: "err", text: "Nothing to pick up." });
      return;
    }
    if (await call({ action: "confirm-pickup", lines, by: pickBy }, "pickup")) {
      setPick({});
      setNotice({
        tone: "ok",
        text: `Pickup recorded — ${lines.length} item${lines.length === 1 ? "" : "s"} taken out of the warehouse.`,
      });
    }
  }

  async function deleteItem(r: InventoryRow) {
    const msg = r.hasShopCount
      ? `Take "${r.name}" out of the warehouse? It stays on the pickup list as something to buy.`
      : `Remove "${r.name}" from the inventory?`;
    if (!window.confirm(msg)) return;
    if (await call({ action: "delete-item", id: r.id }, `delete-${r.id}`)) {
      setNotice({ tone: "ok", text: r.hasShopCount ? `${r.name} is now bought as needed.` : `Removed ${r.name}.` });
    }
  }

  async function trackItem(r: InventoryRow) {
    if (await call({ action: "track-item", id: r.id }, `track-${r.id}`)) {
      setNotice({ tone: "ok", text: `${r.name} is back in the warehouse — set its quantity below.` });
    }
  }

  async function addNew() {
    if (newItem.name.trim() === "") {
      setNotice({ tone: "err", text: "Give the new item a name." });
      return;
    }
    const ok = await call(
      {
        action: "add-item",
        name: newItem.name,
        category: newItem.category.trim() || "Others",
        unit: newItem.unit,
        qty: numOrNull(newItem.qty),
        threshold: numOrNull(newItem.threshold),
      },
      "add",
    );
    if (ok) {
      setNewItem({ name: "", category: "", unit: "", qty: "", threshold: "" });
      setNotice({ tone: "ok", text: "Item added." });
    }
  }

  async function saveCoverDays() {
    const n = Number(coverDays);
    if (!Number.isFinite(n) || n < 1) return;
    if (await call({ action: "set-cover-days", coverDays: n }, "cover")) {
      setNotice({ tone: "ok", text: `A pickup now covers ${Math.round(n)} days.` });
    }
  }

  async function importReports() {
    if (importText.trim() === "") return;
    const j = await call<{ ok: boolean; view?: InventoryView; error?: string; imported?: ImportSummary }>(
      { action: "import-reports", text: importText },
      "import",
    );
    if (!j?.imported) return;
    const { days, added, unknown, ambiguous } = j.imported;
    if (days === 0) {
      setNotice({ tone: "err", text: "No stock-check reports found in that text." });
      return;
    }
    setImportText("");
    const extra = [
      unknown.length ? `unknown names: ${unknown.join(", ")}` : "",
      ambiguous.length ? `skipped as ambiguous: ${ambiguous.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    setNotice({
      tone: "ok",
      text: `Found ${days} day${days === 1 ? "" : "s"}, added ${added} new.${extra ? ` ${extra}.` : ""}`,
    });
  }

  const input =
    "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Warehouse inventory</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {view.today}
            {view.lastShopCountDate ? ` · last shop count ${view.lastShopCountDate}` : " · no shop count yet"}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">A pickup covers</span>
          <input
            inputMode="numeric"
            value={coverDays}
            onChange={(e) => setCoverDays(e.target.value)}
            onBlur={() => {
              if (String(view.coverDays) !== coverDays.trim()) void saveCoverDays();
            }}
            aria-label="Days a pickup covers"
            className={`${input} w-14`}
          />
          <span className="text-zinc-600 dark:text-zinc-400">days</span>
        </label>
      </div>

      {notice && (
        <p
          className={`mt-4 rounded-lg border p-3 text-sm ${
            notice.tone === "ok"
              ? "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100"
              : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* ── Today's pickup ─────────────────────────────────────────── */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Pickup list for today</h2>
          <button
            type="button"
            onClick={() => setShowAllPick((v) => !v)}
            className="text-xs text-zinc-500 underline"
          >
            {showAllPick ? "only what is needed" : "show every item"}
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Computed from today&apos;s stock check: enough for the shop to last {view.coverDays} days
          at its measured usage. Warehouse items first, then what to buy. Edit a number if you take
          more or less, then confirm — the warehouse goes down by what you took.
        </p>

        {!view.countedToday && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            Today&apos;s stock check hasn&apos;t come in yet
            {view.lastShopCountDate ? ` (last one: ${view.lastShopCountDate})` : ""}. The list
            appears once staff submit it.{" "}
            <button type="button" onClick={() => setPeekStale((v) => !v)} className="underline">
              {peekStale ? "Hide the preview" : "Preview using the last count"}
            </button>
          </div>
        )}

        {listReady && suggested.length > 0 && (
          <p className="mt-3 text-sm font-medium">
            {suggested.length} item{suggested.length === 1 ? "" : "s"} today · {pickTotals.warehouse} from
            the warehouse · {pickTotals.buy} to buy
          </p>
        )}

        {listReady && view.todaysPickups.length > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            Already recorded today:{" "}
            {view.todaysPickups
              .map((p) => `${p.lines.length} item${p.lines.length === 1 ? "" : "s"}${p.by ? ` by ${p.by}` : ""}`)
              .join(", ")}
            . The list below is what is still short after that.
          </p>
        )}

        {!listReady ? null : pickRows.length === 0 ? (
          <p className="mt-3 rounded-lg border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            {suggested.length === 0 && view.rows.every((r) => r.usagePerDay == null)
              ? "No usage figures yet. Usage is measured from consecutive stock checks — after tomorrow's count the first numbers appear. To start now, import past report emails below, or type a daily usage in the table."
              : "Nothing to pick up — the shop is covered."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            <li className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3 py-2 text-[11px] uppercase tracking-wide text-zinc-500">
              <span>Item</span>
              <span className="w-16 text-right">Shop</span>
              <span className="w-16 text-right">Per day</span>
              <span className="w-20 text-right">Bring</span>
            </li>
            {pickRows.map((r) => {
              const q = pickQty(r);
              return (
                <li key={r.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{r.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          r.kind === "buy"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {r.kind === "buy" ? "buy" : "warehouse"}
                      </span>
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {REASON_LABEL[r.suggestion.reason]}
                      {r.shopCoverDays != null ? ` · shop lasts ${fmt(r.shopCoverDays)} d` : ""}
                      {r.kind === "warehouse" && r.qty != null
                        ? ` · warehouse ${fmt(r.qty, 2)}${r.unit ? ` ${r.unit}` : ""}`
                        : ""}
                    </div>
                  </div>
                  <span className="w-16 text-right text-sm tabular-nums">{r.shop ? fmt(r.shop.qty, 2) : "—"}</span>
                  <span className="w-16 text-right text-sm tabular-nums">{fmt(r.usagePerDay, 2)}</span>
                  <input
                    inputMode="decimal"
                    value={pick[r.id] ?? String(r.suggestion.bring)}
                    onChange={(e) => setPick((p) => ({ ...p, [r.id]: e.target.value }))}
                    aria-label={`${r.name} quantity to bring`}
                    className={`${input} w-20 ${q > 0 ? "border-[#3B82C4]" : ""}`}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {listReady && pickRows.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              value={pickBy}
              onChange={(e) => setPickBy(e.target.value)}
              placeholder="picked up by"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={confirmPickup}
              disabled={busy !== null}
              className="rounded-lg bg-[#3B82C4] px-5 py-2.5 font-semibold text-white active:scale-[0.98] disabled:opacity-50"
            >
              {busy === "pickup" ? "Recording…" : "Confirm pickup"}
            </button>
          </div>
        )}
      </section>

      {/* ── Reorder alerts ─────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Reorder alerts</h2>
        {low.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Nothing at or below its threshold. Set a threshold in the table to be told when to order.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {low.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
              >
                <span className="font-medium">{r.name}</span>
                <span className="tabular-nums">
                  {fmt(r.qty, 2)}
                  {r.unit ? ` ${r.unit}` : ""} left · order at {fmt(r.threshold, 2)}
                  {r.warehouseCoverDays != null ? ` · ~${fmt(r.warehouseCoverDays, 0)} days` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Weekly cost ────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Weekly cost</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Measured usage × unit cost (ex-GST). Taiwan prices are FOB + 8%, no sea freight; RMB at 4.7.
          Fix a number in the Cost column below.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Ingredients</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">${view.cost.ingredientsWeekly.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Packaging</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">${view.cost.packagingWeekly.toLocaleString()}</div>
          </div>
          <div className="col-span-2 rounded-lg border border-zinc-200 p-3 sm:col-span-1 dark:border-zinc-800">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Total / week</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              ${(view.cost.ingredientsWeekly + view.cost.packagingWeekly).toLocaleString()}
            </div>
          </div>
        </div>
        {view.cost.top.length > 0 && (
          <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {view.cost.top.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-3 py-1.5">
                <span>{t.name}</span>
                <span className="tabular-nums">${t.weeklyCost.toFixed(0)}</span>
              </li>
            ))}
          </ul>
        )}
        {(view.cost.missingCost.length > 0 || view.cost.missingUsage.length > 0) && (
          <p className="mt-2 text-xs text-zinc-500">
            {view.cost.missingCost.length > 0 && <>No cost yet: {view.cost.missingCost.join(", ")}. </>}
            {view.cost.missingUsage.length > 0 && <>No usage yet: {view.cost.missingUsage.join(", ")}.</>}
          </p>
        )}
      </section>

      {/* ── Import past reports ────────────────────────────────────── */}
      <section className="mt-8">
        <button
          type="button"
          onClick={() => setImportOpen((v) => !v)}
          className="text-sm font-semibold underline-offset-2 hover:underline"
        >
          {importOpen ? "▾" : "▸"} Import past stock-check emails
        </button>
        {importOpen && (
          <div className="mt-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Paste the text of old &ldquo;Stock check&rdquo; report emails here, as many as you
              like in one go. Each becomes that day&apos;s shop count, so usage can be measured
              from history instead of waiting for new counts. Days already recorded are left as
              they are.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              placeholder={"Mandy's Bubble Tea — stock check Wed, 03 Sep 2026\n…\nCounted, fine:\n  - Mango: 4"}
              className="mt-2 w-full rounded-lg border border-zinc-300 p-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={importReports}
              disabled={busy !== null || importText.trim() === ""}
              className="mt-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {busy === "import" ? "Importing…" : "Import"}
            </button>
          </div>
        )}
      </section>

      {/* ── The inventory ──────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Stock</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Warehouse quantity, the level that should trigger an order, and daily usage. Usage is
          measured from the shop&apos;s stock checks; type a number to override it, clear the box
          to go back to the measured figure.
        </p>

        <div className="mt-3 grid grid-cols-[1fr_4rem_4rem_4.6rem_4.6rem_2rem] items-center gap-2 px-1 text-[11px] uppercase tracking-wide text-zinc-500">
          <span>Item</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Order at</span>
          <span className="text-right">Per day</span>
          <span className="text-right">Cost</span>
          <span />
        </div>

        {categories.map((cat) => (
          <div key={cat.name} className="mt-4">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{cat.name}</h3>
            <ul className="mt-1 divide-y divide-zinc-200 dark:divide-zinc-800">
              {cat.rows.map((r) => {
                const d = draft[r.id] ?? { qty: "", threshold: "", unit: "", usageOverride: "", unitCost: "" };
                const set = (k: keyof Draft, v: string) =>
                  setDraft((p) => ({ ...p, [r.id]: { ...p[r.id], [k]: v } }));
                return (
                  <li key={r.id} className="grid grid-cols-[1fr_4rem_4rem_4.6rem_4.6rem_2rem] items-center gap-2 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{r.name}</span>
                        {r.low && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-800 dark:bg-red-900 dark:text-red-100">
                            low
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <input
                          value={d.unit}
                          onChange={(e) => set("unit", e.target.value)}
                          placeholder="unit"
                          aria-label={`${r.name} unit`}
                          className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-zinc-300 focus:border-zinc-400 focus:outline-none dark:hover:border-zinc-700"
                        />
                        <span className="truncate">
                          {r.hasShopCount
                            ? r.shop
                              ? `shop ${fmt(r.shop.qty, 2)}`
                              : "shop not counted"
                            : "not on the count sheet"}
                          {r.usageSource === "measured"
                            ? ` · measured ${fmt(r.usage.perDay, 2)}/d over ${r.usage.spanDays} d`
                            : r.usageSource === "override" && r.usage.perDay != null
                              ? ` · measured ${fmt(r.usage.perDay, 2)}/d`
                              : ""}
                          {r.warehouseCoverDays != null ? ` · lasts ~${fmt(r.warehouseCoverDays, 0)} d` : ""}
                          {r.weeklyCost != null ? ` · ${r.weeklyCost.toFixed(0)}/wk` : ""}
                        </span>
                      </div>
                    </div>
                    <input
                      inputMode="decimal"
                      value={d.qty}
                      onChange={(e) => set("qty", e.target.value)}
                      placeholder="—"
                      aria-label={`${r.name} warehouse quantity`}
                      className={`${input} w-full`}
                    />
                    <input
                      inputMode="decimal"
                      value={d.threshold}
                      onChange={(e) => set("threshold", e.target.value)}
                      placeholder="—"
                      aria-label={`${r.name} reorder threshold`}
                      className={`${input} w-full`}
                    />
                    <input
                      inputMode="decimal"
                      value={d.usageOverride}
                      onChange={(e) => set("usageOverride", e.target.value)}
                      placeholder={r.usage.perDay != null ? fmt(r.usage.perDay, 2) : "—"}
                      aria-label={`${r.name} daily usage override`}
                      className={`${input} w-full ${
                        d.usageOverride.trim() !== "" ? "border-amber-400 bg-amber-50 dark:bg-amber-950" : ""
                      }`}
                    />
                    <input
                      inputMode="decimal"
                      value={d.unitCost}
                      onChange={(e) => set("unitCost", e.target.value)}
                      placeholder="—"
                      title={r.costSource || "unit cost, AUD ex-GST"}
                      aria-label={`${r.name} unit cost`}
                      className={`${input} w-full`}
                    />
                    <button
                      type="button"
                      onClick={() => deleteItem(r)}
                      disabled={busy !== null}
                      aria-label={`Remove ${r.name}`}
                      title="Remove"
                      className="grid h-8 w-8 place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {shopOnlyRows.length > 0 && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setShopOnlyOpen((v) => !v)}
              className="text-sm font-semibold underline-offset-2 hover:underline"
            >
              {shopOnlyOpen ? "▾" : "▸"} Bought as needed, not kept in the warehouse ({shopOnlyRows.length})
            </button>
            {shopOnlyOpen && (
              <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
                {shopOnlyRows.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {r.name}
                      <span className="ml-2 text-xs text-zinc-500">
                        {r.usagePerDay != null ? `${fmt(r.usagePerDay, 2)}/d` : "no usage yet"}
                        {r.weeklyCost != null ? ` · ${r.weeklyCost.toFixed(0)}/wk` : ""}
                      </span>
                    </span>
                    <input
                      inputMode="decimal"
                      value={draft[r.id]?.unitCost ?? ""}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          [r.id]: { ...(p[r.id] ?? { qty: "", threshold: "", unit: "", usageOverride: "" }), unitCost: e.target.value },
                        }))
                      }
                      placeholder="cost"
                      title={r.costSource || "unit cost, AUD ex-GST"}
                      aria-label={`${r.name} unit cost`}
                      className={`${input} w-16 text-xs`}
                    />
                    {!r.hasShopCount && (
                      <input
                        inputMode="decimal"
                        value={draft[r.id]?.usageOverride ?? ""}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            [r.id]: { ...(p[r.id] ?? { qty: "", threshold: "", unit: "", unitCost: "" }), usageOverride: e.target.value },
                          }))
                        }
                        placeholder="per day"
                        aria-label={`${r.name} daily usage`}
                        className={`${input} w-16 text-xs`}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => trackItem(r)}
                      disabled={busy !== null}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      Keep in warehouse
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <h3 className="text-sm font-semibold">Add an item</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_5rem_5rem_5rem]">
            <input
              value={newItem.name}
              onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
              placeholder="name"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <input
              value={newItem.category}
              onChange={(e) => setNewItem((p) => ({ ...p, category: e.target.value }))}
              placeholder="category"
              list="inventory-categories"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <datalist id="inventory-categories">
              {categories.map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
            <input
              value={newItem.unit}
              onChange={(e) => setNewItem((p) => ({ ...p, unit: e.target.value }))}
              placeholder="unit"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <input
              inputMode="decimal"
              value={newItem.qty}
              onChange={(e) => setNewItem((p) => ({ ...p, qty: e.target.value }))}
              placeholder="qty"
              className={`${input} text-sm`}
            />
            <input
              inputMode="decimal"
              value={newItem.threshold}
              onChange={(e) => setNewItem((p) => ({ ...p, threshold: e.target.value }))}
              placeholder="order at"
              className={`${input} text-sm`}
            />
          </div>
          <button
            type="button"
            onClick={addNew}
            disabled={busy !== null}
            className="mt-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {busy === "add" ? "Adding…" : "Add"}
          </button>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t bg-white/95 p-4 backdrop-blur dark:bg-black/95">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {dirtyIds.length === 0
              ? "No unsaved edits"
              : `${dirtyIds.length} item${dirtyIds.length === 1 ? "" : "s"} edited`}
          </span>
          <button
            type="button"
            onClick={saveEdits}
            disabled={busy !== null || dirtyIds.length === 0}
            className="ml-auto rounded-lg bg-[#3B82C4] px-5 py-3 font-semibold text-white active:scale-[0.98] disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save edits"}
          </button>
        </div>
      </div>
    </div>
  );
}
