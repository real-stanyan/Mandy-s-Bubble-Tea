"use client";
import { useMemo, useState } from "react";
import type { StockCategory, StockItem } from "@/lib/staff/stocklist";

// The staff-facing count sheet. Designed for a phone held in one hand while
// the other opens a fridge: big tap targets, numeric keypad, and a running
// count of what's left so nobody has to scroll back to find the gap.

type ResultReport = {
  isOrderDay: boolean;
  reorder: Array<{ name: string; qty: number; threshold: number }>;
  weekly: Array<{ name: string; qty: number }>;
  missing: string[];
  okCount: number;
};

type Result = {
  emailed: boolean;
  emailError?: string;
  report: ResultReport;
};

const DRAFT_KEY = "mandys-stock-draft";

export function StockCheckForm({
  categories,
  isOrderDay,
}: {
  categories: StockCategory[];
  isOrderDay: boolean;
}) {
  const [counts, setCounts] = useState<Record<string, string>>(() => {
    // A count takes a few minutes across a fridge, a storeroom and a shelf.
    // Losing it to an accidental back-swipe would mean starting over, so the
    // draft survives a reload until it is successfully submitted.
    if (typeof window === "undefined") return {};
    try {
      const saved = window.localStorage.getItem(DRAFT_KEY);
      return saved ? (JSON.parse(saved) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const [countedBy, setCountedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allItems = useMemo(() => categories.flatMap((c) => c.items), [categories]);
  const filled = allItems.filter((i) => (counts[i.id] ?? "").trim() !== "").length;
  const remaining = allItems.length - filled;

  function set(id: string, value: string) {
    setCounts((prev) => {
      const next = { ...prev, [id]: value };
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      } catch {
        // Private mode / storage full — the draft is a convenience, not a
        // requirement, so a failure here must not block counting.
      }
      return next;
    });
  }

  async function submit() {
    if (remaining > 0) {
      const ok = confirm(
        `${remaining} item${remaining === 1 ? " is" : "s are"} still blank.\n\nBlank items are reported as "not counted", not as zero. Submit anyway?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/staff/stock-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counts, countedBy }),
      });
      const j = (await r.json()) as Result & { ok: boolean };
      if (!j.ok) {
        setError("Submit failed. Try again.");
        return;
      }
      setResult(j);
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* see set() */
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setResult(null);
    setCounts({});
    setCountedBy("");
  }

  if (result) {
    return <ResultView result={result} onStartOver={startOver} />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-6">
      <h1 className="text-2xl font-bold">Stock check</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Count what&apos;s left and enter the number. Leave blank only if you
        genuinely didn&apos;t check it —{" "}
        <b>blank is reported as &ldquo;not counted&rdquo;, not as zero.</b>
      </p>

      {isOrderDay && (
        <div className="mt-4 rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
          <b>It&apos;s Tuesday.</b> The weekly items (marked{" "}
          <span className="font-semibold">weekly</span>) get reported today, so
          please count those too.
        </div>
      )}

      <label className="mt-4 block text-sm">
        <span className="text-zinc-700">Your name (optional)</span>
        <input
          value={countedBy}
          onChange={(e) => setCountedBy(e.target.value)}
          placeholder="who counted"
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
        />
      </label>

      {categories.map((cat) => (
        <section key={cat.id} className="mt-8">
          <h2 className="sticky top-0 z-10 -mx-4 bg-white/90 px-4 py-2 text-lg font-semibold backdrop-blur">
            {cat.name}
          </h2>
          <ul className="mt-1 divide-y divide-zinc-200">
            {cat.items.map((item) => (
              <Row
                key={item.id}
                item={item}
                value={counts[item.id] ?? ""}
                onChange={(v) => set(item.id, v)}
                isOrderDay={isOrderDay}
              />
            ))}
          </ul>
        </section>
      ))}

      {error && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="text-sm tabular-nums text-zinc-600">
            <span>
              {filled}/{allItems.length} counted
            </span>
            {remaining > 0 && (
              <span className="ml-2 text-amber-700">
                {remaining} blank
              </span>
            )}
          </div>
          <button
            onClick={submit}
            disabled={busy}
            className="ml-auto rounded-lg bg-[#3B82C4] px-6 py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : "Submit & email"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  item,
  value,
  onChange,
  isOrderDay,
}: {
  item: StockItem;
  value: string;
  onChange: (v: string) => void;
  isOrderDay: boolean;
}) {
  const parsed = value.trim() === "" ? null : Number(value);
  const low =
    item.rule.kind === "threshold" &&
    parsed != null &&
    Number.isFinite(parsed) &&
    parsed <= item.rule.value;

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.name}</div>
        <div className="text-xs text-zinc-500">
          {item.rule.kind === "threshold" ? (
            <>reorder at {item.rule.value}</>
          ) : (
            <span className={isOrderDay ? "font-semibold text-blue-600" : undefined}>
              weekly — report Tuesdays
            </span>
          )}
        </div>
      </div>
      {low && (
        <span className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
          ORDER
        </span>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="—"
        aria-label={item.name}
        className={`w-20 shrink-0 rounded-lg border px-3 py-2 text-right text-lg tabular-nums ${
          low
            ? "border-red-400 bg-red-50"
            : "border-zinc-300"
        }`}
      />
    </li>
  );
}

function ResultView({ result, onStartOver }: { result: Result; onStartOver: () => void }) {
  const { report } = result;
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Stock check submitted</h1>

      {result.emailed ? (
        <p className="mt-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          Emailed to the shop inbox.
        </p>
      ) : (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <b>Not emailed.</b> {result.emailError ?? "Unknown error."} The counts
          below are still correct — screenshot this page and tell Stan.
        </p>
      )}

      {report.reorder.length === 0 ? (
        <p className="mt-6 text-lg font-semibold text-green-700">
          Nothing below threshold.
        </p>
      ) : (
        <>
          <h2 className="mt-6 text-lg font-semibold text-red-700">
            Order these ({report.reorder.length})
          </h2>
          <ul className="mt-2 divide-y rounded-lg border">
            {report.reorder.map((r) => (
              <li key={r.name} className="flex justify-between px-3 py-2 text-sm">
                <span className="font-medium">{r.name}</span>
                <span className="tabular-nums text-zinc-600">
                  {r.qty} left · reorder at {r.threshold}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {report.isOrderDay && report.weekly.length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-semibold text-blue-700">
            Weekly items (Tuesday)
          </h2>
          <ul className="mt-2 divide-y rounded-lg border">
            {report.weekly.map((r) => (
              <li key={r.name} className="flex justify-between px-3 py-2 text-sm">
                <span>{r.name}</span>
                <span className="tabular-nums text-zinc-600">{r.qty} left</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {report.missing.length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-semibold text-amber-700">
            Not counted ({report.missing.length})
          </h2>
          <p className="text-sm text-zinc-600">{report.missing.join(", ")}</p>
        </>
      )}

      <button
        onClick={onStartOver}
        className="mt-8 rounded-lg border px-4 py-2 text-sm hover:bg-zinc-50"
      >
        Start a new count
      </button>
    </div>
  );
}
