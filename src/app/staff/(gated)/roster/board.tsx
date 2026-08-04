"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  COMFORTABLE_DAYS,
  SHIFT_LABEL,
  STAFF,
  WEEKDAYS,
  WEEKDAY_LABEL,
  autoSlots,
  assignedUnits,
  comfortableDayCapacity,
  countKind,
  daysWorked,
  shiftKey,
  slotCount,
  slotId,
  staffById,
  type Roster,
  type ShiftKind,
  type Weekday,
  type WeekAvailability,
} from "@/lib/staff/roster/model";
import { readableInk } from "@/lib/staff/roster/ink";
import { findViolations, type Violation } from "@/lib/staff/roster/rules";
import { autoSchedule } from "@/lib/staff/roster/schedule";
import { isCurrentWeek, shiftWeek, weekLabel } from "@/lib/staff/roster/week";
import type { StoredWeek } from "@/lib/staff/roster/store";

// The roster board: a week grid, a staff palette, and per-week availability.
//
// Placement is tap-to-select then tap-to-place, with HTML5 drag as an
// enhancement on top. Tapping is the primary interaction on purpose — HTML5
// drag-and-drop does not work on touch screens, and the sheet this replaces is
// most often opened on a phone.

const KINDS: ShiftKind[] = ["open", "mid", "close"];

async function save(
  weekKey: string,
  roster: Roster,
  availability: WeekAvailability,
  pinned: Set<string>,
  setSaveState: (s: SaveState) => void,
  setSaveError: (e: string | null) => void,
) {
  try {
    const r = await fetch("/api/staff/roster", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week: weekKey,
        roster,
        availability,
        pinned: [...pinned],
      }),
    });
    const j = await r.json();
    if (!j.ok) {
      setSaveError(
        j.needsMigration
          ? "The roster table doesn't exist yet — run migration 006."
          : (j.error ?? "Save failed"),
      );
      setSaveState("error");
      return;
    }
    setSaveError(null);
    setSaveState("saved");
  } catch (e) {
    setSaveError(e instanceof Error ? e.message : String(e));
    setSaveState("error");
  }
}

type SaveState = "idle" | "saving" | "saved" | "error";

/** Wait this long after the last edit before writing. */
const SAVE_DEBOUNCE_MS = 700;

/**
 * The week arrives from the server as props and is remounted per week via the
 * `key` below, so switching weeks can never render the previous week's roster
 * for a frame.
 */
export function RosterBoard({
  weekKey,
  initial,
  loadError,
}: {
  weekKey: string;
  initial: StoredWeek;
  loadError: string | null;
}) {
  return (
    <WeekEditor key={weekKey} weekKey={weekKey} initial={initial} loadError={loadError} />
  );
}

function WeekEditor({
  weekKey,
  initial,
  loadError,
}: {
  weekKey: string;
  initial: StoredWeek;
  loadError: string | null;
}) {
  const router = useRouter();
  const [roster, setRoster] = useState<Roster>(initial.roster);
  const [availability, setAvailability] = useState<WeekAvailability>(
    initial.availability,
  );
  // Slots placed by hand. Auto-fill rebuilds around them instead of over them
  // — without this, spending five minutes placing people and then pressing
  // "Auto-fill week" silently threw that work away.
  const [pinned, setPinned] = useState<Set<string>>(new Set(initial.pinned));
  const [picked, setPicked] = useState<string | null>(null);
  const [showAvailability, setShowAvailability] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setWeekKey(next: string) {
    // The week lives in the URL, so moving weeks is a navigation and the
    // server loads the new one. Anything pending is flushed first — otherwise
    // the last edit before clicking "next week" would be dropped.
    flushSave();
    router.push(`/staff/roster?week=${next}`);
  }

  /**
   * Debounced write. Placing eight people is eight state updates in a few
   * seconds, and a request each would be pointless traffic and a chance to
   * apply them out of order.
   */
  const persist = useCallback(
    (nextRoster: Roster, nextWeek: WeekAvailability, nextPinned: Set<string>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState("saving");
      saveTimer.current = setTimeout(() => {
        void save(weekKey, nextRoster, nextWeek, nextPinned, setSaveState, setSaveError);
      }, SAVE_DEBOUNCE_MS);
    },
    [weekKey],
  );

  function flushSave() {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void save(weekKey, roster, availability, pinned, setSaveState, setSaveError);
  }

  const ctx = useMemo(() => ({ week: availability }), [availability]);
  const violations = useMemo(() => findViolations(roster, ctx), [roster, ctx]);
  const violationBySlot = useMemo(() => {
    const map = new Map<string, Violation[]>();
    for (const v of violations) {
      for (const id of v.slotIds) map.set(id, [...(map.get(id) ?? []), v]);
    }
    return map;
  }, [violations]);

  function update(next: Roster, nextPinned: Set<string> = pinned) {
    setRoster(next);
    setPinned(nextPinned);
    persist(next, availability, nextPinned);
  }

  function updateAvailability(next: WeekAvailability) {
    setAvailability(next);
    persist(roster, next, pinned);
  }

  function assign(slot: string, staffId: string | null) {
    const next = { ...roster };
    const nextPinned = new Set(pinned);
    if (staffId) {
      next[slot] = staffId;
      nextPinned.add(slot);
    } else {
      delete next[slot];
      nextPinned.delete(slot);
    }
    update(next, nextPinned);
    // The banner describes the last auto run. Once the grid is edited by hand
    // it can be actively wrong — "could not fill 1 shift" while looking at the
    // shift you just filled — so it goes.
    setNote(null);
  }

  /** Everything currently pinned, as a seed the scheduler must keep. */
  function pinnedSeed(): Roster {
    const seed: Roster = {};
    for (const slot of pinned) {
      const id = roster[slot];
      if (id) seed[slot] = id;
    }
    return seed;
  }

  function onCellClick(slot: string) {
    if (picked) {
      assign(slot, picked);
      return;
    }
    // No chip selected: tapping a filled cell clears it, so removing someone
    // doesn't need a separate mode.
    if (roster[slot]) assign(slot, null);
  }

  function runAuto() {
    setBusy(true);
    setNote(null);
    // Yield first so the button paints its busy state before the solver
    // takes the thread for a few hundred milliseconds.
    setTimeout(() => {
      try {
        // Rebuilds the week around whatever is pinned, never over it.
        const seed = pinnedSeed();
        const kept = Object.keys(seed).length;
        const result = autoSchedule(ctx, seed);
        update(result.roster);
        const keptNote = kept > 0 ? ` Kept your ${kept} pinned shift${kept === 1 ? "" : "s"}.` : "";
        setNote(
          result.complete
            ? `Filled every shift.${keptNote}`
            : `Could not fill ${result.unfilled.length} shift${result.unfilled.length === 1 ? "" : "s"} — left empty for Twinkle or a swap.${keptNote}`,
        );
      } finally {
        setBusy(false);
      }
    }, 0);
  }

  function fillGaps() {
    setBusy(true);
    setNote(null);
    setTimeout(() => {
      try {
        // Seeded with what's already there: auto respects manual picks and
        // only fills the empties.
        const result = autoSchedule(ctx, roster);
        update(result.roster);
        setNote(
          result.complete
            ? "Filled the gaps."
            : `Still ${result.unfilled.length} unfilled.`,
        );
      } finally {
        setBusy(false);
      }
    }, 0);
  }

  const hard = violations.filter((v) => v.severity === "hard");
  const soft = violations.filter((v) => v.severity === "soft");
  // Measured against the slots auto fills, not the whole grid: Twinkle's three
  // evening slots aren't staff demand, and counting them would report a
  // shortfall that doesn't exist.
  const slotTotal = autoSlots().length;
  const capacity = comfortableDayCapacity(availability);
  const shortfall = slotTotal - capacity;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Roster</h1>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setWeekKey(shiftWeek(weekKey, -1))}
            className="rounded border px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            aria-label="previous week"
          >
            ←
          </button>
          <span className="min-w-36 text-center font-semibold tabular-nums">
            {weekLabel(weekKey)}
            {isCurrentWeek(weekKey) && (
              <span className="ml-1 text-xs font-normal text-blue-600">this week</span>
            )}
          </span>
          <button
            onClick={() => setWeekKey(shiftWeek(weekKey, 1))}
            className="rounded border px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            aria-label="next week"
          >
            →
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={runAuto}
          disabled={busy}
          className="rounded-lg bg-[#3B82C4] px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Auto-fill week"}
        </button>
        <button
          onClick={fillGaps}
          disabled={busy}
          className="rounded-lg border px-4 py-2 hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-900"
        >
          Fill gaps only
        </button>
        <button
          onClick={() => update({}, new Set())}
          disabled={busy}
          className="rounded-lg border px-4 py-2 hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-900"
        >
          Clear
        </button>
        {pinned.size > 0 && (
          <button
            onClick={() => update(roster, new Set())}
            disabled={busy}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-900"
          >
            Unpin all ({pinned.size})
          </button>
        )}
        <button
          onClick={() => setShowAvailability((v) => !v)}
          className="rounded-lg border px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          {showAvailability ? "Hide" : "Availability"}
        </button>
      </div>

      {/* Saving is silent and remote now, so its state has to be visible —
          otherwise a failed write looks exactly like a successful one until
          somebody reloads and finds the week empty. */}
      {(saveState !== "idle" || loadError) && (
        <p
          className={`mt-3 text-xs ${
            saveState === "error" || loadError
              ? "font-semibold text-red-600"
              : "text-zinc-500"
          }`}
        >
          {loadError
            ? `Couldn't load this week: ${loadError}`
            : saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : `Not saved — ${saveError}`}
        </p>
      )}

      {note && (
        <p className="mt-3 rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
          {note}
        </p>
      )}

      {showAvailability && (
        <AvailabilityPanel value={availability} onChange={updateAvailability} />
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_260px]">
        <Grid
          weekKey={weekKey}
          roster={roster}
          pinned={pinned}
          picked={picked}
          violationBySlot={violationBySlot}
          onCellClick={onCellClick}
          onDropStaff={(slot, staffId) => assign(slot, staffId)}
        />
        <Palette
          roster={roster}
          picked={picked}
          onPick={(id) => setPicked((p) => (p === id ? null : id))}
        />
      </div>

      {(hard.length > 0 || soft.length > 0) && (
        <div className="mt-6 space-y-3">
          {hard.length > 0 && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
              <h3 className="text-sm font-bold text-red-800 dark:text-red-200">
                Breaks a rule ({hard.length})
              </h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-red-800 dark:text-red-200">
                {hard.map((v, i) => (
                  <li key={i}>{v.message}</li>
                ))}
              </ul>
            </div>
          )}
          {soft.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
              <h3 className="text-sm font-bold text-amber-800 dark:text-amber-200">
                Worth a look ({soft.length})
              </h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-amber-800 dark:text-amber-200">
                {soft.map((v, i) => (
                  <li key={i}>{v.message}</li>
                ))}
              </ul>
              {soft.some((v) => /works \d+ days/.test(v.message)) && (
                // Without this the six-day warning reads as something the
                // scheduler could have avoided, and the obvious next move is
                // to hand-shuffle the grid looking for a fix that isn't there.
                <p className="mt-2 border-t border-amber-300 pt-2 text-xs text-amber-800 dark:border-amber-800 dark:text-amber-200">
                  Every shift is one person-day. Covering all {slotTotal} needs{" "}
                  {slotTotal}; this week the team can comfortably give {capacity} — so{" "}
                  <b>
                    {shortfall} {shortfall === 1 ? "person has" : "people have"} to
                    work a sixth day
                  </b>{" "}
                  unless you leave that many shifts for Twinkle. Eugenia is Wed-Sat
                  only, Elle is Saturday only, and Celina&apos;s two units are a
                  single 12-22.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Grid({
  weekKey,
  roster,
  pinned,
  picked,
  violationBySlot,
  onCellClick,
  onDropStaff,
}: {
  weekKey: string;
  roster: Roster;
  pinned: Set<string>;
  picked: string | null;
  violationBySlot: Map<string, Violation[]>;
  onCellClick: (slot: string) => void;
  onDropStaff: (slot: string, staffId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr>
            {/* The sheet this replaces heads its corner cell with the week
                range, so a printed or screenshotted grid says which week it
                is without the surrounding page. */}
            <th className="w-28 border p-2 text-left font-bold tabular-nums">
              {weekLabel(weekKey)}
            </th>
            {KINDS.map((k) => (
              <th key={k} className="border p-2 text-right font-bold">
                {SHIFT_LABEL[k]}
              </th>
            ))}
            <th className="border p-2 text-left text-xs font-normal text-zinc-500">
              Twinkle
              <br />
              (Fri/Sat/Sun)
            </th>
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((day) => (
            <tr key={day}>
              <th className="border p-2 text-left font-bold">{WEEKDAY_LABEL[day]}</th>
              {KINDS.map((kind) => (
                <Cell
                  key={kind}
                  slot={slotId({ day, kind, index: 0 })}
                  roster={roster}
                  pinned={pinned}
                  picked={picked}
                  violations={violationBySlot.get(slotId({ day, kind, index: 0 }))}
                  onClick={onCellClick}
                  onDropStaff={onDropStaff}
                />
              ))}
              {slotCount(day, "close") > 1 ? (
                <Cell
                  slot={slotId({ day, kind: "close", index: 1 })}
                  roster={roster}
                  pinned={pinned}
                  picked={picked}
                  violations={violationBySlot.get(slotId({ day, kind: "close", index: 1 }))}
                  onClick={onCellClick}
                  onDropStaff={onDropStaff}
                />
              ) : (
                <td className="border bg-zinc-50 dark:bg-zinc-900" />
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  slot,
  roster,
  pinned,
  picked,
  violations,
  onClick,
  onDropStaff,
}: {
  slot: string;
  roster: Roster;
  pinned: Set<string>;
  picked: string | null;
  violations?: Violation[];
  onClick: (slot: string) => void;
  onDropStaff: (slot: string, staffId: string) => void;
}) {
  const id = roster[slot];
  const staff = id ? staffById(id) : undefined;
  const isPinned = pinned.has(slot);
  const hard = violations?.some((v) => v.severity === "hard");
  const soft = violations?.some((v) => v.severity === "soft");

  return (
    <td
      className={`border p-0 ${hard ? "outline outline-2 -outline-offset-2 outline-red-600" : soft ? "outline outline-2 -outline-offset-2 outline-amber-500" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const dropped = e.dataTransfer.getData("text/plain");
        if (dropped) onDropStaff(slot, dropped);
      }}
    >
      <button
        onClick={() => onClick(slot)}
        title={[
          ...(violations?.map((v) => v.message) ?? []),
          isPinned ? "Pinned — auto-fill will keep this" : "",
        ]
          .filter(Boolean)
          .join("\n")}
        className={`flex h-11 w-full items-center gap-1 px-2 text-left font-medium ${
          staff ? "" : "text-zinc-400"
        } ${picked && !staff ? "ring-1 ring-inset ring-blue-400" : ""}`}
        // The palette runs from a pale yellow to a mid blue, so the name's
        // colour has to follow its own cell rather than being fixed dark.
        style={
          staff
            ? { backgroundColor: staff.color, color: readableInk(staff.color) }
            : undefined
        }
      >
        {isPinned && staff && (
          <span aria-label="pinned" className="text-xs leading-none">
            📌
          </span>
        )}
        <span className="truncate">{staff?.name ?? (picked ? "tap to place" : "")}</span>
      </button>
    </td>
  );
}

function Palette({
  roster,
  picked,
  onPick,
}: {
  roster: Roster;
  picked: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <aside className="space-y-2">
      <h2 className="text-sm font-bold">Staff</h2>
      <p className="text-xs text-zinc-500">
        Tap a name then tap a cell. Tap a filled cell with nothing selected to
        clear it. Dragging works too on a computer.
      </p>
      <p className="text-xs text-zinc-500">
        Anything you place by hand gets a 📌 and{" "}
        <b>Auto-fill week keeps it</b> — place the shifts you care about first,
        then let auto do the rest.
      </p>
      {STAFF.map((s) => {
        const units = assignedUnits(roster, s.id);
        const over = units > s.maxUnits;
        const under = units < s.minUnits;
        return (
          <button
            key={s.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", s.id)}
            onClick={() => onPick(s.id)}
            className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left ${
              picked === s.id ? "ring-2 ring-blue-500" : ""
            }`}
          >
            <span
              className="h-6 w-6 shrink-0 rounded"
              style={{ backgroundColor: s.color }}
            />
            <span className="flex-1 font-medium">{s.name}</span>
            <span
              className={`text-xs tabular-nums ${
                over ? "font-bold text-red-600" : under ? "text-amber-600" : "text-zinc-500"
              }`}
            >
              {units}/{s.maxUnits}
            </span>
          </button>
        );
      })}
      <div className="rounded-lg border p-2 text-xs text-zinc-500">
        <div className="flex justify-between font-semibold text-zinc-700 dark:text-zinc-300">
          <span></span>
          <span>days · opens/closes</span>
        </div>
        {STAFF.filter((s) => assignedUnits(roster, s.id) > 0).map((s) => {
          const days = daysWorked(roster, s.id);
          return (
            <div key={s.id} className="flex justify-between tabular-nums">
              <span>{s.name}</span>
              <span>
                <b className={days > COMFORTABLE_DAYS ? "text-amber-600" : undefined}>
                  {days}d
                </b>{" "}
                · {countKind(roster, s.id, "open")}/{countKind(roster, s.id, "close")}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function AvailabilityPanel({
  value,
  onChange,
}: {
  value: WeekAvailability;
  onChange: (next: WeekAvailability) => void;
}) {
  // Which staff have the per-shift detail open. Most leave is whole days, so
  // the fine grid stays folded away until it's asked for.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleDay(staffId: string, day: Weekday, mode: "on" | "off") {
    const entry = value[staffId] ?? {};
    const list = entry[mode] ?? [];
    const next = list.includes(day) ? list.filter((d) => d !== day) : [...list, day];
    onChange({ ...value, [staffId]: { ...entry, [mode]: next } });
  }

  function toggleShift(staffId: string, day: Weekday, kind: ShiftKind, optIn: boolean) {
    const entry = value[staffId] ?? {};
    const field = optIn ? "onShifts" : "offShifts";
    const key = shiftKey(day, kind);
    const list = entry[field] ?? [];
    const next = list.includes(key)
      ? list.filter((k) => k !== key)
      : [...list, key];
    onChange({ ...value, [staffId]: { ...entry, [field]: next } });
  }

  return (
    <div className="mt-4 rounded-lg border p-3">
      <h2 className="text-sm font-bold">This week&apos;s availability</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Everyone works their usual days unless you mark them off. Use{" "}
        <b>by shift</b> when someone is only away part of a day — marking the
        whole day off gives away shifts they could still cover. Celina is the
        exception: she reports a week ahead, so she is only rostered on the days
        you tick.
      </p>
      <div className="mt-3 space-y-2">
        {STAFF.filter((s) => s.auto).map((s) => {
          const optIn = s.availability === "opt-in";
          const mode = optIn ? "on" : "off";
          const selected = value[s.id]?.[mode] ?? [];
          const shiftList = value[s.id]?.[optIn ? "onShifts" : "offShifts"] ?? [];
          const open = expanded.has(s.id);
          return (
            <div key={s.id} className="rounded border p-2">
              <div className="flex flex-wrap items-center gap-1">
                <span
                  className="h-4 w-4 shrink-0 rounded"
                  style={{ backgroundColor: s.color }}
                />
                <span className="w-16 text-sm font-medium">{s.name}</span>
                <span className="w-20 text-xs text-zinc-500">
                  {optIn ? "can work:" : "away:"}
                </span>
                {WEEKDAYS.map((d) => {
                  const usual = s.days.includes(d);
                  const active = selected.includes(d);
                  const partial = shiftList.some((k) => k.startsWith(`${d}-`));
                  return (
                    <button
                      key={d}
                      disabled={!usual}
                      onClick={() => toggleDay(s.id, d, mode)}
                      title={partial ? "some shifts set individually" : undefined}
                      className={`w-11 rounded border px-1 py-1 text-xs capitalize ${
                        !usual
                          ? "cursor-not-allowed opacity-30"
                          : active
                            ? optIn
                              ? "border-green-600 bg-green-100 font-bold text-green-800"
                              : "border-red-500 bg-red-100 font-bold text-red-700"
                            : partial
                              ? "border-amber-500 bg-amber-50 text-amber-800"
                              : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      }`}
                    >
                      {d}
                      {partial && !active ? "*" : ""}
                    </button>
                  );
                })}
                <button
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                  className="ml-1 rounded border px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  {open ? "hide" : "by shift"}
                </button>
              </div>

              {open && (
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-zinc-500">
                      <th className="w-20 text-left font-normal"></th>
                      {WEEKDAYS.map((d) => (
                        <th key={d} className="font-normal capitalize">
                          {d}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(["open", "mid", "close"] as ShiftKind[])
                      .filter((k) => s.kinds.includes(k))
                      .map((kind) => (
                        <tr key={kind}>
                          <td className="py-0.5 text-zinc-600 dark:text-zinc-400">
                            {SHIFT_LABEL[kind]}
                          </td>
                          {WEEKDAYS.map((d) => {
                            const usual = s.days.includes(d);
                            const dayLevel = selected.includes(d);
                            const set = shiftList.includes(shiftKey(d, kind));
                            return (
                              <td key={d} className="p-0.5 text-center">
                                <button
                                  disabled={!usual}
                                  onClick={() => toggleShift(s.id, d, kind, optIn)}
                                  className={`h-6 w-full rounded border ${
                                    !usual
                                      ? "cursor-not-allowed opacity-20"
                                      : set
                                        ? optIn
                                          ? "border-green-600 bg-green-100 text-green-800"
                                          : "border-red-500 bg-red-100 text-red-700"
                                        : dayLevel
                                          ? "border-zinc-300 bg-zinc-200 opacity-60 dark:bg-zinc-700"
                                          : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                                  }`}
                                >
                                  {set ? (optIn ? "✓" : "✕") : dayLevel ? "–" : ""}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
