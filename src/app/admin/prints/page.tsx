import { getSupabaseAdmin } from "@/lib/supabase-server";
import { PrintsTable, type Job } from "./table";

type Heartbeat = {
  device_id: string;
  last_seen_at: string;
  printer_status: string;
  pending_count: number;
};

export const dynamic = "force-dynamic";

export default async function AdminPrintsPage() {
  const admin = getSupabaseAdmin();
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

  const [statsResult, jobsResult, heartbeatResult, upcomingResult] = await Promise.all([
    admin.from("print_jobs").select("status", { count: "exact" }).gte("created_at", startOfDay),
    admin.from("print_jobs").select("*").order("created_at", { ascending: false }).limit(100),
    admin.from("printer_heartbeats").select("*"),
    // Scheduled orders whose sticker is still HELD (due in the future) —
    // the counter's "what's coming up" number.
    admin
      .from("print_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .gt("print_due_at", new Date().toISOString()),
  ]);

  const byStatus = { pending: 0, printed: 0, failed: 0, stale: 0 };
  for (const r of statsResult.data ?? []) {
    const s = (r as { status: keyof typeof byStatus }).status;
    if (s in byStatus) byStatus[s]++;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Print jobs</h1>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Pending" value={byStatus.pending} />
        <Stat label="Printed today" value={byStatus.printed} />
        <Stat label="Failed" value={byStatus.failed} />
        <Stat label="Stale" value={byStatus.stale} />
        <Stat label="预约待出票" value={upcomingResult.count ?? 0} />
      </div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Devices</h2>
        <ul className="space-y-1 text-sm">
          {((heartbeatResult.data ?? []) as Heartbeat[]).map((h) => {
            const ageSec = Math.round((Date.now() - new Date(h.last_seen_at).getTime()) / 1000);
            const healthy = ageSec < 120;
            return (
              <li key={h.device_id} className={healthy ? "text-green-700" : "text-red-700"}>
                <code>{h.device_id}</code> — printer {h.printer_status}, pending {h.pending_count}, seen {ageSec}s ago
              </li>
            );
          })}
        </ul>
      </div>
      <PrintsTable jobs={(jobsResult.data ?? []) as unknown as Job[]} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4 rounded-lg border bg-white">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
