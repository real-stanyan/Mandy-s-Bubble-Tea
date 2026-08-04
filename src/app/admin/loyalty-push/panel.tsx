"use client";
import { useState } from "react";
import type { CampaignCopy, CampaignId } from "@/lib/loyalty-campaigns";

export type Run = {
  id: string;
  campaign: string;
  title_singular: string;
  cooldown_days: number;
  eligible_count: number;
  suppressed_count: number;
  targeted_count: number;
  accepted_count: number;
  errored_count: number;
  created_at: string;
};

type CampaignOption = {
  id: CampaignId;
  label: string;
  description: string;
  defaultCooldownDays: number;
  defaultCopy: CampaignCopy;
};

type Preview = {
  starsPerReward: number;
  eligiblePhones: number;
  reachablePhones: number;
  suppressedPhones: number;
  deviceCount: number;
  breakdown: Array<{ n: number; phones: number; preview: { title: string; body: string } }>;
};

export function LoyaltyPushPanel({
  campaigns,
  runs,
}: {
  campaigns: CampaignOption[];
  runs: Run[];
}) {
  const [campaignId, setCampaignId] = useState<CampaignId>(campaigns[0].id);
  const current = campaigns.find((c) => c.id === campaignId)!;
  const [copy, setCopy] = useState<CampaignCopy>(current.defaultCopy);
  const [cooldownDays, setCooldownDays] = useState(current.defaultCooldownDays);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "send">(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  function switchCampaign(id: CampaignId) {
    const next = campaigns.find((c) => c.id === id)!;
    setCampaignId(id);
    setCopy(next.defaultCopy);
    setCooldownDays(next.defaultCooldownDays);
    // A preview belongs to the campaign it was built for — dropping it
    // forces a re-preview so Send can never act on a stale audience.
    setPreview(null);
    setError(null);
    setSent(null);
  }

  function editCopy(patch: Partial<CampaignCopy>) {
    setCopy((c) => ({ ...c, ...patch }));
    setPreview(null);
    setSent(null);
  }

  async function runPreview() {
    setBusy("preview");
    setError(null);
    setSent(null);
    try {
      const r = await fetch("/api/admin/loyalty-push/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign: campaignId, cooldownDays, copy }),
      });
      const j = await r.json();
      if (!j.ok) setError(j.error ?? "Preview failed");
      else setPreview(j as Preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!preview) return;
    if (
      !confirm(
        `Send this notification to ${preview.deviceCount} device${preview.deviceCount === 1 ? "" : "s"}?\n\nThis is real and cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy("send");
    setError(null);
    try {
      const r = await fetch("/api/admin/loyalty-push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign: campaignId,
          cooldownDays,
          copy,
          expectedDeviceCount: preview.deviceCount,
        }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error ?? "Send failed");
      } else if (!j.sent) {
        setError(`Nothing sent — ${j.reason}`);
      } else {
        setSent(
          `Sent: ${j.accepted} accepted, ${j.errored} errored${j.errors?.length ? ` (${j.errors.join("; ")})` : ""}`,
        );
        setPreview(null);
        setTimeout(() => location.reload(), 1500);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {campaigns.map((c) => (
          <button
            key={c.id}
            onClick={() => switchCampaign(c.id)}
            className={`px-3 py-2 rounded border text-sm ${
              c.id === campaignId
                ? "bg-[#3B82C4] text-white border-[#3B82C4]"
                : "bg-white hover:bg-gray-50"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-gray-600">{current.description}</p>

      <div className="rounded-lg border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Message</h2>
        <p className="text-xs text-gray-500">
          <code>{"{n}"}</code> is replaced with the customer&apos;s number —
          free drinks available, or drinks still needed. The plural version is
          used whenever that number is 2 or more.
        </p>
        <Field
          label="Title (1)"
          value={copy.titleSingular}
          onChange={(v) => editCopy({ titleSingular: v })}
        />
        <Field
          label="Body (1)"
          value={copy.bodySingular}
          onChange={(v) => editCopy({ bodySingular: v })}
          textarea
        />
        <Field
          label="Title (2+)"
          value={copy.titlePlural}
          onChange={(v) => editCopy({ titlePlural: v })}
        />
        <Field
          label="Body (2+)"
          value={copy.bodyPlural}
          onChange={(v) => editCopy({ bodyPlural: v })}
          textarea
        />
        <label className="block text-sm">
          <span className="text-gray-700">
            Cooldown (days) — skip anyone who already got this campaign inside
            the window. 0 disables.
          </span>
          <input
            type="number"
            min={0}
            value={cooldownDays}
            onChange={(e) => {
              setCooldownDays(Math.max(0, Number(e.target.value) || 0));
              setPreview(null);
            }}
            className="mt-1 w-28 rounded border px-2 py-1"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={runPreview}
          disabled={busy !== null}
          className="px-4 py-2 rounded border hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === "preview" ? "Checking…" : "Preview audience"}
        </button>
        <button
          onClick={send}
          disabled={busy !== null || !preview || preview.deviceCount === 0}
          className="px-4 py-2 rounded bg-[#C43A10] text-white disabled:opacity-40"
        >
          {busy === "send"
            ? "Sending…"
            : preview
              ? `Send to ${preview.deviceCount} device${preview.deviceCount === 1 ? "" : "s"}`
              : "Send"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {sent && (
        <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          {sent}
        </div>
      )}

      {preview && (
        <div className="rounded-lg border bg-white p-4 space-y-3">
          <h2 className="font-semibold">
            Audience — {preview.starsPerReward} stars per free drink
          </h2>
          <ul className="text-sm space-y-1">
            <li>
              Matching this campaign: <b>{preview.eligiblePhones}</b> customers
            </li>
            <li>
              …of those, have the app: <b>{preview.reachablePhones}</b>
            </li>
            <li>
              …held back by cooldown: <b>{preview.suppressedPhones}</b>
            </li>
            <li className="pt-1 border-t">
              Will be pushed: <b>{preview.deviceCount}</b> devices
            </li>
          </ul>
          {preview.breakdown.length > 0 && (
            <div className="space-y-2 pt-2">
              <h3 className="text-sm font-semibold">What they&apos;ll see</h3>
              {preview.breakdown.map((b) => (
                <div key={b.n} className="rounded border bg-gray-50 p-3">
                  <div className="text-xs text-gray-500 mb-1">
                    n = {b.n} · {b.phones} customer{b.phones === 1 ? "" : "s"}
                  </div>
                  <div className="font-semibold text-sm">{b.preview.title}</div>
                  <div className="text-sm text-gray-700">{b.preview.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="font-semibold mb-2">Recent sends</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing sent yet.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">When</th>
                <th className="p-2">Campaign</th>
                <th className="p-2">Sent</th>
                <th className="p-2">Skipped</th>
                <th className="p-2">Title</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-2 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("en-AU", {
                      timeZone: "Australia/Brisbane",
                    })}
                  </td>
                  <td className="p-2">{r.campaign}</td>
                  <td className="p-2">
                    {r.accepted_count}
                    {r.errored_count > 0 && (
                      <span className="text-red-700"> (+{r.errored_count} failed)</span>
                    )}
                  </td>
                  <td className="p-2 text-gray-600">
                    {r.suppressed_count > 0 ? `${r.suppressed_count} on cooldown` : "—"}
                  </td>
                  <td className="p-2 text-gray-700">{r.title_singular}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
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
      <span className="text-gray-700">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded border px-2 py-1"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded border px-2 py-1"
        />
      )}
    </label>
  );
}
