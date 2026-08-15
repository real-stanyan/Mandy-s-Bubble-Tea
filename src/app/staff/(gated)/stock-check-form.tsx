"use client";
import { useMemo, useState } from "react";
import {
  SUFFICIENCY_CHOICES,
  SUFFICIENCY_LABEL,
  ruleHint,
  type StockCategory,
  type StockItem,
  type Sufficiency,
} from "@/lib/staff/stocklist";
import { describeAge, type StockSnapshot } from "@/lib/staff/stock-history";
import { CountKeypadSheet } from "./count-keypad";
import { VoiceCountSheet } from "./voice-count-sheet";

// The staff-facing count sheet. Designed for a phone held in one hand while
// the other opens a fridge: big tap targets, a thumb-sized drum instead of the
// keyboard, and a running count of what's left so nobody has to scroll back to
// find the gap.

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
  previous,
}: {
  categories: StockCategory[];
  isOrderDay: boolean;
  /** Last submitted count, from the server. Null before the first one. */
  previous: StockSnapshot | null;
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
  // The item whose drum is open, if any. One sheet for the whole list rather
  // than one per row: only one thing is ever being counted.
  // Tracked by id, not by position: most items are walked in order, but a
  // weekly one opened on a Wednesday is not in the walk at all, and a position
  // could not name it.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previousLabel = previous ? describeAge(previous.date, new Date()) : null;

  // Weekly items are pulled out of their categories into one section of their
  // own. Mixed in, a Tuesday-only item sat between two everyday ones with only
  // a caption to tell them apart — easy to count out of habit on a Wednesday,
  // easy to skip on a Tuesday. Separated, "what do I have to count today" is
  // answered by where you are on the page.
  const daily = useMemo(
    () =>
      categories
        .map((c) => ({ ...c, items: c.items.filter((i) => i.rule.kind !== "weekly") }))
        .filter((c) => c.items.length > 0),
    [categories],
  );
  const weekly = useMemo(
    () => categories.flatMap((c) => c.items.filter((i) => i.rule.kind === "weekly")),
    [categories],
  );

  // Only due on Tuesdays. Off order day the weekly items stay visible and
  // editable — someone noticing an empty box should still be able to say so —
  // but they are out of the required flow: not in the progress count, not in
  // the keypad walk, and never counted as "blank".
  const dueItems = useMemo(
    () => (isOrderDay ? [...daily.flatMap((c) => c.items), ...weekly] : daily.flatMap((c) => c.items)),
    [daily, weekly, isOrderDay],
  );
  const filled = dueItems.filter((i) => (counts[i.id] ?? "").trim() !== "").length;
  const remaining = dueItems.length - filled;
  const allItems = useMemo(() => categories.flatMap((c) => c.items), [categories]);
  const picking = pickedId === null ? null : (allItems.find((i) => i.id === pickedId) ?? null);
  // -1 means "open, but not part of today's walk" — edit it and close.
  const walkIndex = pickedId === null ? -1 : dueItems.findIndex((i) => i.id === pickedId);
  const previousOf = (id: string) => previous?.counts[id] ?? null;

  /** Writes what the voice sheet heard into the same draft the keypad uses,
   *  so a spoken pass and a tapped pass are the same count. */
  function applyVoice(values: Record<string, string>) {
    setCounts((prev) => {
      const next = { ...prev, ...values };
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      } catch {
        // Draft is a convenience; a storage failure must not lose the count.
      }
      return next;
    });
  }

  /**
   * Open at the first item still blank, so picking the count back up after a
   * break doesn't mean scrolling to find where you stopped.
   */
  function startCounting() {
    const firstBlank = dueItems.findIndex((i) => (counts[i.id] ?? "").trim() === "");
    setPickedId(dueItems[firstBlank === -1 ? 0 : firstBlank]?.id ?? null);
  }

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

  /**
   * Wipe every number and start the count again.
   *
   * The draft goes with it — leaving it behind would put the old numbers
   * straight back on the next page load.
   */
  function clearAll() {
    setCounts({});
    setPickedId(null);
    setConfirmingClear(false);
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* see set() */
    }
  }

  if (result) {
    return <ResultView result={result} onStartOver={startOver} />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-6">
      {/* Plain link rather than a button: the page behind it 404s for anyone
          without the owner passcode, so it costs nothing to show and saves the
          owner remembering a URL. */}
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Stock check</h1>
        <a href="/staff/thresholds" className="text-sm text-zinc-500 underline">
          Thresholds
        </a>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Count what&apos;s left and enter the number. Leave blank only if you
        genuinely didn&apos;t check it —{" "}
        <b>blank is reported as &ldquo;not counted&rdquo;, not as zero.</b>
      </p>

      {isOrderDay && (
        <div className="mt-4 rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
          <b>It&apos;s Tuesday.</b> The weekly items (marked{" "}
          <span className="font-semibold">weekly</span>) get reported today, so
          please count those too.
        </div>
      )}

      <label className="mt-4 block text-sm">
        <span className="text-zinc-700 dark:text-zinc-300">Your name (optional)</span>
        <input
          value={countedBy}
          onChange={(e) => setCountedBy(e.target.value)}
          placeholder="who counted"
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      {daily.map((cat) => (
        <section key={cat.id} className="mt-8">
          <h2 className="sticky top-0 z-10 -mx-4 bg-white/90 px-4 py-2 text-lg font-semibold backdrop-blur dark:bg-black/90">
            {cat.name}
          </h2>
          <ul className="mt-1 divide-y divide-zinc-200 dark:divide-zinc-800">
            {cat.items.map((item) => (
              <Row
                key={item.id}
                item={item}
                value={counts[item.id] ?? ""}
                previous={previousOf(item.id)}
                previousLabel={previousLabel}
                onOpen={() => setPickedId(item.id)}
                onSet={(v) => set(item.id, v)}
                isOrderDay={isOrderDay}
              />
            ))}
          </ul>
        </section>
      ))}

      {/* The slow movers, in one block at the end rather than scattered
          through the categories above. On a Tuesday this is a short list to
          work through; the rest of the week it is the part you scroll past. */}
      {weekly.length > 0 && (
        <section className="mt-10">
          <h2
            className={`sticky top-0 z-10 -mx-4 px-4 py-2 text-lg font-semibold backdrop-blur ${
              isOrderDay
                ? "bg-blue-50/90 text-blue-800 dark:bg-blue-950/90 dark:text-blue-200"
                : "bg-white/90 text-zinc-400 dark:bg-black/90"
            }`}
          >
            Weekly items{" "}
            <span className="text-sm font-normal">
              {isOrderDay
                ? `— due today, all ${weekly.length}`
                : "— Tuesdays only, skip today"}
            </span>
          </h2>
          <ul
            className={`mt-1 divide-y divide-zinc-200 dark:divide-zinc-800 ${
              isOrderDay ? "" : "opacity-60"
            }`}
          >
            {weekly.map((item) => (
              <Row
                key={item.id}
                item={item}
                value={counts[item.id] ?? ""}
                previous={previousOf(item.id)}
                previousLabel={previousLabel}
                onOpen={() => setPickedId(item.id)}
                onSet={(v) => set(item.id, v)}
                isOrderDay={isOrderDay}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Down here rather than in the sticky bar on purpose: clearing throws
          away a whole walk around the shop, so it should take scrolling past
          everything to reach, and it must never sit next to Submit.

          Two steps. The first button stays put and goes inert rather than
          being replaced, so a double-tap — or a thumb that bounces — lands on
          a dead control instead of on the confirmation that has just appeared
          underneath it. Relying on the confirm button merely being drawn
          somewhere else would make the safety a matter of pixels.

          A page dialog rather than confirm() so the wording, the count, and
          the button positions are ours. */}
      {filled > 0 && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            onClick={() => setConfirmingClear(true)}
            disabled={confirmingClear}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 active:scale-[0.98] disabled:opacity-40 dark:border-red-900 dark:text-red-400"
          >
            Clear all numbers
          </button>

          {confirmingClear && (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-red-300 p-4 dark:border-red-900">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Clear all {filled} number{filled === 1 ? "" : "s"}? This
                can&apos;t be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmingClear(false)}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium active:scale-[0.98] dark:border-zinc-700"
                >
                  Cancel
                </button>
                <button
                  onClick={clearAll}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
                >
                  Yes, clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/95 p-3 backdrop-blur dark:border-zinc-800 dark:bg-black/95">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
            <span>
              {filled}/{dueItems.length} counted
            </span>
            {remaining > 0 && (
              <span className="ml-2 text-amber-700 dark:text-amber-500">
                {remaining} blank
              </span>
            )}
          </div>
          {/* The main way in. Tapping individual rows still works, but the
              whole count is meant to be one pass: open here, then number-Next
              all the way down without touching the list again. */}
          {remaining > 0 && (
            <>
              {/* Talking beats tapping when both hands are on a shelf, but it
                  is the second option, not the first: the keypad walk is what
                  works when the shop is loud, and this fills the same fields
                  rather than replacing them. */}
              <button
                onClick={() => setVoiceOpen(true)}
                className="ml-auto rounded-lg border px-4 py-3 font-semibold"
              >
                Count out loud
              </button>
              <button
                onClick={startCounting}
                className="rounded-lg border px-4 py-3 font-semibold"
              >
                {filled === 0 ? "Start counting" : "Continue"}
              </button>
            </>
          )}
          <button
            onClick={submit}
            disabled={busy}
            className={`rounded-lg bg-[#3B82C4] px-6 py-3 font-semibold text-white disabled:opacity-50 ${
              remaining > 0 ? "" : "ml-auto"
            }`}
          >
            {busy ? "Sending…" : "Submit & email"}
          </button>
        </div>
      </div>

      {voiceOpen && (
        <VoiceCountSheet onApply={applyVoice} onClose={() => setVoiceOpen(false)} />
      )}

      {picking && (
        <CountKeypadSheet
          // Remounting per item is what resets the entry and the "first digit
          // replaces" flag, and it is instant — the sheet never leaves.
          key={picking.id}
          title={picking.name}
          hint={ruleHint(picking, isOrderDay)}
          choices={
            picking.rule.kind === "sufficiency" ? SUFFICIENCY_CHOICES : undefined
          }
          value={counts[picking.id] ?? ""}
          // Both undefined for an item outside today's walk: the sheet then
          // edits this one and closes instead of claiming a position.
          index={walkIndex >= 0 ? walkIndex : undefined}
          total={walkIndex >= 0 ? dueItems.length : undefined}
          previous={previousOf(picking.id)}
          previousLabel={previousLabel}
          onCommit={(next) => set(picking.id, next)}
          onMove={(delta) => {
            const next = walkIndex + delta;
            // Running off either end closes rather than wrapping: wrapping
            // back to Mango after the last item would read as "nothing
            // happened" and quietly restart the count.
            setPickedId(
              next < 0 || next >= dueItems.length ? null : (dueItems[next]?.id ?? null),
            );
          }}
          onClose={() => setPickedId(null)}
        />
      )}
    </div>
  );
}

function Row({
  item,
  value,
  previous,
  previousLabel,
  onOpen,
  onSet,
  isOrderDay,
}: {
  item: StockItem;
  value: string;
  /** What this item counted last time, or null if there is no reading. */
  previous: string | null;
  previousLabel: string | null;
  onOpen: () => void;
  onSet?: (value: string) => void;
  isOrderDay: boolean;
}) {
  // Cups and straws are answered, not counted — three buttons instead of the
  // number pad, because nobody tallies a stack of 1,400 cups and a number
  // typed here would be invented.
  if (item.rule.kind === "sufficiency") {
    return (
      <SufficiencyRow item={item} value={value} previous={previous} onSet={onSet} />
    );
  }

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
          ) : isOrderDay ? (
            <span className="font-semibold text-blue-600">weekly — due today</span>
          ) : (
            <span className="text-zinc-400">weekly — Tuesdays only</span>
          )}
          {/* The previous reading, next to the rule rather than in the box:
              it is context for the number being entered, never a default. A
              blank box must stay visibly blank. */}
          {previous != null && (
            <span className="ml-2 tabular-nums text-zinc-400">
              was {previous}
              {previousLabel ? ` ${previousLabel}` : ""}
            </span>
          )}
        </div>
      </div>
      {low && (
        <span className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
          ORDER
        </span>
      )}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${item.name}${value ? `, ${value}` : ", not counted"}`}
        className={`w-20 shrink-0 rounded-lg border px-3 py-2 text-right text-lg tabular-nums transition-transform duration-150 ease-out active:scale-[0.97] ${
          low
            ? "border-red-400 bg-red-50 dark:bg-red-950"
            : "border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900"
        } ${value.trim() === "" ? "text-zinc-400" : ""}`}
      >
        {value.trim() === "" ? "—" : value}
      </button>
    </li>
  );
}

/**
 * Cups and straws: three buttons, no number.
 *
 * Sized for a thumb on a phone in a shop, and deliberately unselected until
 * someone taps — a default would be answered by the layout rather than by
 * looking at the shelf, and "enough" is exactly the answer nobody should get
 * for free.
 */
function SufficiencyRow({
  item,
  value,
  previous,
  onSet,
}: {
  item: StockItem;
  value: string;
  previous: string | null;
  onSet?: (value: string) => void;
}) {
  const options = SUFFICIENCY_CHOICES;

  return (
    <li className="py-3">
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{item.name}</span>
        <span className="text-xs text-zinc-500">enough for today?</span>
        {previous != null && SUFFICIENCY_LABEL[previous as Sufficiency] && (
          <span className="ml-auto text-xs text-zinc-400">
            was {SUFFICIENCY_LABEL[previous as Sufficiency]}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {options.map((o) => {
          const active = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={active}
              onClick={() => onSet?.(active ? "" : o.key)}
              className={`rounded-lg border px-2 py-3 text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.97] ${
                active
                  ? o.tone
                  : "border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
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
