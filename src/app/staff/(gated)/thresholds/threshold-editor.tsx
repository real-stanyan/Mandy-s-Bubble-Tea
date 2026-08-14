"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { ThresholdOverrides } from "@/lib/staff/stocklist";

type EditableItem = { id: string; name: string; fallback: number };
type EditableCategory = { id: string; name: string; items: EditableItem[] };

/**
 * Editing the reorder thresholds.
 *
 * stocklist.ts argues against this screen existing: a wrong threshold
 * under-orders silently for weeks, and the list only changes a few times a
 * year. Stan asked for it anyway, so the design answers that argument rather
 * than ignoring it — the default is shown beside every changed number, a
 * change is labelled with who made it and when, and one tap puts it back.
 * Nothing here is destructive and nothing is hidden.
 */
export function ThresholdEditor({
  categories,
  overrides,
}: {
  categories: EditableCategory[];
  overrides: ThresholdOverrides;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [id, o] of Object.entries(overrides)) out[id] = String(o.value);
    return out;
  });
  const [changedBy, setChangedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = useMemo(() => categories.flatMap((c) => c.items), [categories]);

  /** What this item will be if saved now. */
  const effective = (item: EditableItem): number => {
    const raw = draft[item.id];
    if (raw == null || raw.trim() === "") return item.fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : item.fallback;
  };

  const changedCount = all.filter((i) => effective(i) !== i.fallback).length;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Every item is sent, not just the edited ones: a blank box means "use
      // the default", and the server has to be told that to drop an override
      // that already exists.
      const thresholds: Record<string, string> = {};
      for (const i of all) thresholds[i.id] = draft[i.id] ?? "";
      const r = await fetch("/api/staff/stock-thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholds, changedBy }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) {
        setError(j.error === "forbidden" ? "Owner passcode required." : "Save failed.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-6">
      <Link href="/staff" className="text-sm text-zinc-500 underline">
        ← Back to stock check
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Reorder thresholds</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        An item is flagged to order when the count is <b>at or below</b> this
        number. Leave a box empty to use the built-in default.
      </p>
      <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        Set one of these too low and nothing looks wrong — the shop just quietly
        runs out weeks later. Change one at a time, and put your name below so
        the next person can see who decided.
      </p>

      <label className="mt-4 block text-sm">
        <span className="text-zinc-700 dark:text-zinc-300">Your name</span>
        <input
          value={changedBy}
          onChange={(e) => setChangedBy(e.target.value)}
          placeholder="who changed it"
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      {categories.map((cat) => (
        <section key={cat.id} className="mt-8">
          <h2 className="text-lg font-semibold">{cat.name}</h2>
          <ul className="mt-1 divide-y divide-zinc-200 dark:divide-zinc-800">
            {cat.items.map((item) => {
              const o = overrides[item.id];
              const changed = effective(item) !== item.fallback;
              return (
                <li key={item.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.name}</div>
                    <div className="text-xs text-zinc-500">
                      default {item.fallback}
                      {o && (
                        <span className="ml-2 text-amber-600 dark:text-amber-400">
                          changed to {o.value}
                          {o.by ? ` by ${o.by}` : ""}
                          {o.at ? ` · ${o.at.slice(0, 10)}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  {changed && (
                    <button
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, [item.id]: "" }))}
                      className="shrink-0 rounded px-2 py-1 text-xs text-zinc-500 underline"
                    >
                      reset
                    </button>
                  )}
                  <input
                    inputMode="decimal"
                    value={draft[item.id] ?? ""}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, [item.id]: e.target.value }))
                    }
                    placeholder={String(item.fallback)}
                    aria-label={`${item.name} reorder threshold`}
                    className={`w-20 shrink-0 rounded-lg border px-3 py-2 text-right tabular-nums ${
                      changed
                        ? "border-amber-400 bg-amber-50 dark:bg-amber-950"
                        : "border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900"
                    }`}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className="fixed inset-x-0 bottom-0 border-t bg-white/95 p-4 backdrop-blur dark:bg-black/95">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {changedCount === 0
              ? "No changes"
              : `${changedCount} changed from default`}
          </span>
          {error && <span className="text-sm text-red-600">{error}</span>}
          {saved && <span className="text-sm text-green-600">Saved</span>}
          <button
            onClick={save}
            disabled={busy}
            className="ml-auto rounded-lg bg-[#3B82C4] px-5 py-3 font-semibold text-white active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
