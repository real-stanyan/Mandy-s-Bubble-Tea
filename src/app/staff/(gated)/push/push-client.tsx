"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CampaignId,
  CampaignSettings,
  Copy,
  Platform,
  Segment,
  Vars,
} from "@/lib/push-center/campaigns";
import type { Funnel } from "@/lib/push-center/audience.server";
import type { StateSummary } from "@/lib/push-center/state-store";

/**
 * Push Center. One screen: pick a campaign, read the words, see exactly who
 * would get them, press send. Nothing here sends on its own — the data does
 * the counting, the owner does the deciding.
 */

export type Run = {
  id: string;
  campaign: string;
  title: string;
  targeted_count: number;
  accepted_count: number;
  errored_count: number;
  delivered_count: number | null;
  failed_count: number | null;
  receipts_checked_at: string | null;
  cooldown_count: number;
  capped_count: number;
  created_at: string;
};

export type CampaignOption = {
  id: CampaignId;
  label: string;
  description: string;
  url: string;
  defaultCopy: Copy;
  defaultSettings: CampaignSettings;
  placeholders: Array<keyof Vars>;
};

type Preview = {
  funnel: Funnel;
  samples: Copy[];
  context: {
    starsPerReward: number;
    forecast: { date: string; maxC: number | null; rainMm: number | null; rainChancePct: number | null } | null;
    kitchen: { level: string; pendingCups: number; label: string } | null;
    specials: {
      items: Array<{ name: string; priceCents: number; originalCents: number }>;
      missing: string[];
      itemsText: string;
      priceText: string;
    } | null;
    state: StateSummary;
  };
  fingerprint: string | null;
  quietHours: boolean;
  now: string;
};

const PLACEHOLDER_HELP: Record<keyof Vars, string> = {
  drink: "their most-ordered drink",
  stars: "current star balance",
  n: "drinks short / free drinks available",
  days: "days since their last order",
  temp: "today's forecast maximum",
  items: "this week's specials",
  price: "the specials price",
};

const brisbane = (iso: string) =>
  new Date(iso).toLocaleString("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function PushClient({
  campaigns,
  runs,
  state,
  needsMigration,
}: {
  campaigns: CampaignOption[];
  runs: Run[];
  state: StateSummary;
  needsMigration: boolean;
}) {
  const router = useRouter();
  const [campaignId, setCampaignId] = useState<CampaignId>(campaigns[0].id);
  const current = campaigns.find((c) => c.id === campaignId)!;
  const [copy, setCopy] = useState<Copy>(current.defaultCopy);
  const [settings, setSettings] = useState<CampaignSettings>(current.defaultSettings);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "send" | "refresh" | string>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err" | "warn"; text: string } | null>(null);
  const [override, setOverride] = useState(false);

  function switchCampaign(id: CampaignId) {
    const next = campaigns.find((c) => c.id === id)!;
    setCampaignId(id);
    setCopy(next.defaultCopy);
    setSettings(next.defaultSettings);
    // A preview belongs to the campaign and words it was built for; dropping
    // it means Send can never act on a stale audience.
    setPreview(null);
    setNotice(null);
    setOverride(false);
  }

  function editCopy(patch: Partial<Copy>) {
    setCopy((c) => ({ ...c, ...patch }));
    setPreview(null);
  }

  function editSettings(patch: Partial<CampaignSettings>) {
    setSettings((s) => ({ ...s, ...patch }));
    setPreview(null);
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await r.json()) as T;
  }

  async function runPreview() {
    setBusy("preview");
    setNotice(null);
    try {
      const j = await post<({ ok: true } & Preview) | { ok: false; error?: string }>("/api/staff/push/preview", {
        campaign: campaignId,
        settings,
        copy,
      });
      if (!j.ok) {
        setNotice({ tone: "err", text: j.error === "forbidden" ? "Owner passcode required." : (j.error ?? "Preview failed.") });
        return;
      }
      setPreview(j);
      // Specials: the words come from the shelf. Show what will actually go
      // out rather than the template with braces in it.
      if (j.context.specials && campaignId === "weekly_specials" && j.samples[0]) {
        // keep the editable template; the samples show the rendered version
      }
    } catch (e) {
      setNotice({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!preview) return;
    const n = preview.funnel.devices;
    if (!confirm(`Send “${preview.samples[0]?.title ?? copy.title}” to ${n} device${n === 1 ? "" : "s"}?\n\nThis is real and cannot be undone.`)) return;
    setBusy("send");
    setNotice(null);
    try {
      const j = await post<
        | { ok: true; sent: true; accepted: number; errored: number; targeted: number; errors: string[] }
        | { ok: true; sent: false; reason: string }
        | { ok: false; code?: string; error?: string }
      >("/api/staff/push/send", {
        campaign: campaignId,
        settings,
        copy,
        expectedDeviceCount: n,
        fingerprint: preview.fingerprint,
        overrideQuietHours: override,
      });
      if (!j.ok) {
        setNotice({ tone: "err", text: j.error === "forbidden" ? "Owner passcode required." : (j.error ?? "Send failed.") });
        if (j.code === "drift" || j.code === "prices_changed") setPreview(null);
        return;
      }
      if (!j.sent) {
        setNotice({ tone: "warn", text: `Nothing sent — ${j.reason}.` });
        setPreview(null);
        return;
      }
      setNotice({
        tone: "ok",
        text: `Expo accepted ${j.accepted} of ${j.targeted}${j.errored ? `, ${j.errored} refused (${j.errors.join("; ")})` : ""}. Receipts are checked in about ten seconds — refresh the list.`,
      });
      setPreview(null);
      setOverride(false);
      router.refresh();
    } catch (e) {
      setNotice({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function refreshState() {
    setBusy("refresh");
    setNotice(null);
    try {
      const j = await post<
        | { ok: true; result: { ran: false; reason: string } | { ran: true; orders: number; customers: number; caughtUp: boolean } }
        | { ok: false; error?: string }
      >("/api/staff/push/refresh-state", {});
      if (!j.ok) {
        setNotice({ tone: "err", text: j.error ?? "Refresh failed." });
        return;
      }
      if (!j.result.ran) {
        setNotice({
          tone: j.result.reason === "no-cursor" ? "warn" : "ok",
          text:
            j.result.reason === "no-cursor"
              ? "No customer history yet — run scripts/push-state-backfill.ts once, then the cron keeps it fresh."
              : "Already up to date.",
        });
      } else {
        setNotice({
          tone: "ok",
          text: `Folded ${j.result.orders} orders for ${j.result.customers} customers${j.result.caughtUp ? "" : " — more to catch up, press again"}.`,
        });
      }
      setPreview(null);
      router.refresh();
    } catch (e) {
      setNotice({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function checkReceipts(runId: string) {
    setBusy(`receipts:${runId}`);
    try {
      const j = await post<{ ok: true; delivered: number; failed: number; pending: number } | { ok: false; error?: string }>(
        "/api/staff/push/receipts",
        { runId },
      );
      if (!j.ok) setNotice({ tone: "err", text: j.error ?? "Could not check receipts." });
      else {
        setNotice({
          tone: j.pending ? "warn" : "ok",
          text: `${j.delivered} delivered, ${j.failed} failed${j.pending ? `, ${j.pending} still pending — try again in a minute` : ""}.`,
        });
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  const showInactive = campaignId === "near_threshold" || campaignId === "redeem_ready";
  const showSegment = campaignId === "custom";
  const historyNeeded = !["weekly_specials", "custom"].includes(campaignId);
  const noHistory = state.tableMissing || state.rows === 0;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Push</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Pick a campaign, read the words, preview exactly who gets them, then send. The data does the
            counting; you decide when. Nothing goes out on its own.
          </p>
        </div>
        <div className="text-right text-xs text-zinc-500">
          {state.tableMissing ? (
            <span>Customer history: not set up</span>
          ) : (
            <span>
              Customer history: {state.rows.toLocaleString("en-AU")} customers
              {state.cursor ? ` · refreshed ${ago(state.cursor.cursor)}` : " · never refreshed"}
            </span>
          )}
          <button
            type="button"
            onClick={refreshState}
            disabled={busy !== null || state.tableMissing}
            className="ml-3 rounded border px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-900"
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      </div>

      {needsMigration && (
        <div className="mb-5 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Setup needed.</b> Apply <code>supabase/migrations/2026-09-10-push-center.sql</code>, then run the
          backfill script once. Sending is disabled until then — without the ledger there is no cooldown
          record, so a second click would notify everyone again.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <aside className="space-y-1">
          {campaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => switchCampaign(c.id)}
              className={`block w-full rounded border px-3 py-2 text-left text-sm ${
                c.id === campaignId
                  ? "border-[#3B82C4] bg-[#3B82C4] text-white"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
              }`}
            >
              {c.label}
            </button>
          ))}
        </aside>

        <div className="space-y-5">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{current.description}</p>

          {historyNeeded && noHistory && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              This campaign reads customers&apos; order history, and there is none yet. Run the backfill
              script once; until then it matches nobody.
            </div>
          )}

          <div className="space-y-4 rounded-lg border p-4">
            <h2 className="font-semibold">Message</h2>
            <Field label="Title" value={copy.title} onChange={(v) => editCopy({ title: v })} />
            <Field label="Body" value={copy.body} onChange={(v) => editCopy({ body: v })} textarea />
            {current.placeholders.length > 0 && (
              <p className="text-xs text-zinc-500">
                Fills in per customer:{" "}
                {current.placeholders.map((p) => (
                  <span key={p} className="mr-2 inline-block">
                    <code>{`{${p}}`}</code> {PLACEHOLDER_HELP[p]}
                  </span>
                ))}
                {(current.placeholders.includes("n") || current.placeholders.includes("stars")) && (
                  <span className="mr-2 inline-block">
                    <code>{"{stars|star|stars}"}</code> picks singular or plural (same for <code>{"{n|…|…}"}</code>)
                  </span>
                )}
              </p>
            )}
            <p className="text-xs text-zinc-500">
              Opens <code>{current.url}</code> in the app.
            </p>
          </div>

          <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
            <h2 className="font-semibold sm:col-span-2">Who</h2>
            <label className="block text-sm">
              <span className="text-zinc-700 dark:text-zinc-300">Cooldown (days) — skip anyone who got this campaign inside the window</span>
              <input
                type="number"
                min={0}
                value={settings.cooldownDays}
                onChange={(e) => editSettings({ cooldownDays: Math.max(0, Number(e.target.value) || 0) })}
                className="mt-1 w-28 rounded border bg-transparent px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-700 dark:text-zinc-300">Platform</span>
              <select
                value={settings.platform}
                onChange={(e) => editSettings({ platform: e.target.value as Platform })}
                className="mt-1 block w-40 rounded border bg-transparent px-2 py-1"
              >
                <option value="all">iOS + Android</option>
                <option value="ios">iOS only</option>
                <option value="android">Android only</option>
              </select>
            </label>
            {showInactive && (
              <label className="block text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">Only if quiet for at least (days) — people who just bought are coming anyway</span>
                <input
                  type="number"
                  min={0}
                  value={settings.minInactiveDays}
                  onChange={(e) => editSettings({ minInactiveDays: Math.max(0, Number(e.target.value) || 0) })}
                  className="mt-1 w-28 rounded border bg-transparent px-2 py-1"
                />
              </label>
            )}
            {showSegment && (
              <label className="block text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">Audience</span>
                <select
                  value={settings.segment}
                  onChange={(e) => editSettings({ segment: e.target.value as Segment })}
                  className="mt-1 block w-56 rounded border bg-transparent px-2 py-1"
                >
                  <option value="all">Everyone with the app</option>
                  <option value="active">Active — ordered in the last 14 days</option>
                  <option value="cooling">Cooling — 15–30 days</option>
                  <option value="lapsing">Lapsing — 31–60 days</option>
                  <option value="lost">Lost — over 60 days</option>
                  <option value="never">Installed, never ordered</option>
                </select>
              </label>
            )}
            <div className="space-y-2 text-sm sm:col-span-2">
              <Check
                checked={settings.weeklyCap}
                onChange={(v) => editSettings({ weeklyCap: v })}
                label="Weekly cap — at most two marketing pushes per person per 7 days, 48 hours apart"
              />
              <Check
                checked={settings.skipRecentBuyers}
                onChange={(v) => editSettings({ skipRecentBuyers: v })}
                label="Skip anyone who ordered in the last 24 hours"
              />
              <Check
                checked={settings.holdout}
                onChange={(v) => editSettings({ holdout: v })}
                label="Keep a stable 10% out (holdout) — the only way to measure what a push actually did"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runPreview}
              disabled={busy !== null}
              className="rounded border px-4 py-2 hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-900"
            >
              {busy === "preview" ? "Counting…" : "Preview audience"}
            </button>
            <button
              type="button"
              onClick={send}
              disabled={busy !== null || !preview || preview.funnel.devices === 0 || needsMigration || (preview.quietHours && !override)}
              className="rounded bg-[#C43A10] px-4 py-2 text-white disabled:opacity-40"
            >
              {busy === "send"
                ? "Sending…"
                : preview
                  ? `Send to ${preview.funnel.devices} device${preview.funnel.devices === 1 ? "" : "s"}`
                  : "Send"}
            </button>
            {preview?.quietHours && (
              <label className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                Send anyway — it&apos;s outside 10:30–20:30 shop time
              </label>
            )}
          </div>

          {notice && (
            <div
              className={`rounded border p-3 text-sm ${
                notice.tone === "ok"
                  ? "border-green-300 bg-green-50 text-green-800"
                  : notice.tone === "warn"
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-red-300 bg-red-50 text-red-800"
              }`}
            >
              {notice.text}
            </div>
          )}

          {preview && (
            <div className="space-y-4 rounded-lg border p-4">
              <h2 className="font-semibold">Audience</h2>
              <FunnelTable funnel={preview.funnel} />
              <ContextLines preview={preview} campaignId={campaignId} />
              {preview.samples.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">What they&apos;ll see</h3>
                  {preview.samples.map((s, i) => (
                    <div key={i} className="rounded-xl border bg-zinc-50 p-3 dark:bg-zinc-900">
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-500">
                        <span className="inline-block h-3 w-3 rounded-sm bg-[#C43A10]" /> Mandy&apos;s · now
                      </div>
                      <div className="mt-1 text-sm font-semibold">{s.title}</div>
                      <div className="text-sm text-zinc-700 dark:text-zinc-300">{s.body}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Nobody to show a message to.</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-10">
        <h2 className="mb-2 font-semibold">Recent sends</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing sent from here yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-zinc-100 text-left dark:bg-zinc-900">
                  <th className="p-2">When</th>
                  <th className="p-2">Campaign</th>
                  <th className="p-2">Title</th>
                  <th className="p-2 text-right">Devices</th>
                  <th className="p-2 text-right">Accepted</th>
                  <th className="p-2 text-right">Delivered</th>
                  <th className="p-2 text-right">Skipped</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="whitespace-nowrap p-2">{brisbane(r.created_at)}</td>
                    <td className="p-2">{campaigns.find((c) => c.id === r.campaign)?.label ?? r.campaign}</td>
                    <td className="max-w-[16rem] truncate p-2 text-zinc-700 dark:text-zinc-300">{r.title}</td>
                    <td className="p-2 text-right tabular-nums">{r.targeted_count}</td>
                    <td className="p-2 text-right tabular-nums">
                      {r.accepted_count}
                      {r.errored_count > 0 && <span className="text-red-700"> (+{r.errored_count} refused)</span>}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {r.receipts_checked_at ? (
                        <>
                          {r.delivered_count ?? 0}
                          {(r.failed_count ?? 0) > 0 && <span className="text-red-700"> / {r.failed_count} failed</span>}
                        </>
                      ) : (
                        <span className="text-zinc-500">checking…</span>
                      )}
                    </td>
                    <td className="p-2 text-right text-zinc-500 tabular-nums">
                      {r.cooldown_count + r.capped_count > 0 ? `${r.cooldown_count + r.capped_count}` : "—"}
                    </td>
                    <td className="p-2 text-right">
                      <button
                        type="button"
                        onClick={() => checkReceipts(r.id)}
                        disabled={busy !== null}
                        className="text-xs underline hover:text-zinc-900 disabled:opacity-40 dark:hover:text-zinc-100"
                      >
                        {busy === `receipts:${r.id}` ? "Checking…" : "Check receipts"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FunnelTable({ funnel }: { funnel: Funnel }) {
  const rows: Array<[string, number, boolean?]> = [
    ["Have the app", funnel.withApp],
    ["…and match the rule", funnel.matched],
    ["− on cooldown", funnel.cooldown, true],
    ["− weekly cap", funnel.capped, true],
    ["− bought in the last 24 h", funnel.recentBuyers, true],
    ["− holdout", funnel.holdout, true],
  ];
  return (
    <div className="text-sm">
      <table className="w-full max-w-md">
        <tbody>
          {rows.map(([label, n, minus]) => (
            <tr key={label} className={minus && n === 0 ? "text-zinc-400" : ""}>
              <td className="py-0.5">{label}</td>
              <td className="py-0.5 text-right tabular-nums">{n}</td>
            </tr>
          ))}
          <tr className="border-t font-semibold">
            <td className="py-1">Will be pushed</td>
            <td className="py-1 text-right tabular-nums">
              {funnel.devices} device{funnel.devices === 1 ? "" : "s"}
              <span className="ml-2 font-normal text-zinc-500">
                iOS {funnel.ios} · Android {funnel.android}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ContextLines({ preview, campaignId }: { preview: Preview; campaignId: CampaignId }) {
  const { forecast, kitchen, specials, state } = preview.context;
  const lines: React.ReactNode[] = [];
  if (forecast) {
    lines.push(
      <li key="wx">
        Today&apos;s forecast: {forecast.maxC != null ? `${forecast.maxC.toFixed(0)}°` : "—"}
        {forecast.rainMm != null ? `, ${forecast.rainMm.toFixed(1)} mm rain` : ""}
        {forecast.rainChancePct != null ? ` (${forecast.rainChancePct}% chance)` : ""}
        {campaignId === "hot_day" && forecast.maxC != null && forecast.maxC < 26 && (
          <span className="text-amber-700"> — under 26°, not really a hot day</span>
        )}
        {campaignId === "rain_day" && forecast.rainMm != null && forecast.rainMm < 5 && (
          <span className="text-amber-700"> — not much rain forecast</span>
        )}
      </li>,
    );
  }
  if (kitchen) {
    lines.push(
      <li key="k">
        Kitchen now: {kitchen.level} ({kitchen.pendingCups} cups in the queue, ready in {kitchen.label})
        {kitchen.level !== "quiet" && <span className="text-amber-700"> — not quiet; the message promises 2–3 minutes</span>}
      </li>,
    );
  }
  if (specials) {
    lines.push(
      <li key="s">
        Shelf from Square:{" "}
        {specials.items.length === 0
          ? "nothing matched the config"
          : specials.items
              .map((i) => `${i.name} ${dollars(i.priceCents)}${i.originalCents > i.priceCents ? ` (was ${dollars(i.originalCents)})` : ""}`)
              .join(" · ")}
        {specials.missing.length > 0 && (
          <span className="text-amber-700"> — not in the catalog: {specials.missing.join(", ")}</span>
        )}
      </li>,
    );
  }
  if (!state.tableMissing) {
    lines.push(
      <li key="st">
        Order history: {state.rows.toLocaleString("en-AU")} customers
        {state.cursor ? `, up to ${brisbane(state.cursor.cursor)}` : ", never refreshed"}
      </li>,
    );
  }
  if (preview.quietHours) {
    lines.push(
      <li key="q" className="text-amber-700">
        It&apos;s {brisbane(preview.now)} in Southport — outside the 10:30–20:30 window.
      </li>,
    );
  }
  if (lines.length === 0) return null;
  return <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">{lines}</ul>;
}

function Field({
  label,
  value,
  onChange,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-zinc-700 dark:text-zinc-300">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          maxLength={300}
          className="mt-1 w-full rounded border bg-transparent px-2 py-1"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={120}
          className="mt-1 w-full rounded border bg-transparent px-2 py-1"
        />
      )}
    </label>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
      <span className="text-zinc-700 dark:text-zinc-300">{label}</span>
    </label>
  );
}
