"use client";
import { useState } from "react";

type Job = {
  id: string;
  square_order_id: string;
  source: string;
  sticker_number: string;
  status: string;
  attempts: number;
  cups: Array<{ drinkName: string }>;
  created_at: string;
  last_error: string | null;
};

export function PrintsTable({ jobs }: { jobs: Job[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  async function reprint(id: string) {
    if (!confirm("Clone and reprint this job?")) return;
    setBusyId(id);
    try {
      const r = await fetch("/api/admin/prints/reprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) alert("Reprint failed: " + (await r.text()));
      else location.reload();
    } finally {
      setBusyId(null);
    }
  }
  async function dismiss(id: string) {
    if (!confirm("Mark this job handled and remove it from the list?")) return;
    setBusyId(id);
    try {
      const r = await fetch("/api/admin/prints/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) alert("Dismiss failed: " + (await r.text()));
      else location.reload();
    } finally {
      setBusyId(null);
    }
  }
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-gray-100 text-left">
          <th className="p-2">Sticker</th>
          <th className="p-2">Source</th>
          <th className="p-2">Status</th>
          <th className="p-2">When</th>
          <th className="p-2">Cups</th>
          <th className="p-2"></th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => {
          // Online (web/app) orders are the ones staff can miss — highlight them.
          const online = j.source === "web";
          return (
          <tr
            key={j.id}
            className={
              online
                ? "border-b border-l-4 border-l-[#C43A10] bg-[#FBEDE7]"
                : "border-b"
            }
          >
            <td className="p-2 font-mono">{j.sticker_number}</td>
            <td className="p-2">
              {online ? (
                <span className="inline-flex items-center rounded bg-[#C43A10] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                  线上
                </span>
              ) : (
                <span className="text-gray-600">{j.source}</span>
              )}
            </td>
            <td className="p-2">
              <span className={
                j.status === "printed" ? "text-green-700"
                : j.status === "failed" ? "text-red-700"
                : j.status === "stale" ? "text-gray-500" : "text-amber-700"
              }>
                {j.status}{j.attempts > 0 ? ` (${j.attempts}x)` : ""}
              </span>
              {j.last_error ? <div className="text-xs text-red-600">{j.last_error}</div> : null}
            </td>
            <td className="p-2">{new Date(j.created_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane" })}</td>
            <td className="p-2">{j.cups.map((c) => c.drinkName).join(", ")}</td>
            <td className="p-2 space-x-2 whitespace-nowrap">
              <button
                disabled={busyId === j.id}
                onClick={() => reprint(j.id)}
                className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                {busyId === j.id ? "..." : "Reprint"}
              </button>
              {(j.status === "failed" || j.status === "stale") && (
                <button
                  disabled={busyId === j.id}
                  onClick={() => dismiss(j.id)}
                  className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Dismiss
                </button>
              )}
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}
