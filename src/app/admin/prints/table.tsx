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
        {jobs.map((j) => (
          <tr key={j.id} className="border-b">
            <td className="p-2 font-mono">{j.sticker_number}</td>
            <td className="p-2">{j.source}</td>
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
            <td className="p-2">
              <button
                disabled={busyId === j.id}
                onClick={() => reprint(j.id)}
                className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                {busyId === j.id ? "..." : "Reprint"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
