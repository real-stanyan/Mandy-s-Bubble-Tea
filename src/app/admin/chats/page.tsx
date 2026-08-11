import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { CHAT_LOG_RETENTION_DAYS } from "@/lib/chat/log";

export const dynamic = "force-dynamic";

/** Conversations per page. Enough to scan a busy day without turning the
 *  page into an unbounded query as the table grows. */
const PAGE_SIZE = 40;

type LogRow = {
  id: number;
  created_at: string;
  conversation_id: string;
  turn_index: number;
  role: "user" | "assistant";
  content: string;
  surface: string | null;
  proposal_count: number;
  action: string | null;
};

/** Brisbane is UTC+10 with no DST — the same offset trick the rest of the
 *  codebase uses rather than Intl, which differs across runtimes. */
function bne(iso: string): string {
  const d = new Date(Date.parse(iso) + 10 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export default async function AdminChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c: openId } = await searchParams;
  const admin = getSupabaseAdmin();

  // Newest messages first, then grouped in memory. The alternative — a
  // DISTINCT-on query — needs an RPC; this page is for the shop owner
  // reading today's chats, not an analytics surface, so the simple read
  // wins until the volume says otherwise.
  const { data, error } = await admin
    .from("chat_logs")
    .select(
      "id, created_at, conversation_id, turn_index, role, content, surface, proposal_count, action",
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE * 20);

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="font-serif text-2xl font-semibold">Chat logs</h1>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          Chat logs aren&apos;t available yet: {error.message}
          <br />
          If this says the table is missing, the{" "}
          <code>2026-08-11-chat-logs.sql</code> migration hasn&apos;t been applied
          yet. Chats still work — they just aren&apos;t being recorded.
        </p>
      </main>
    );
  }

  const rows = (data ?? []) as LogRow[];
  const byConversation = new Map<string, LogRow[]>();
  for (const r of rows) {
    const list = byConversation.get(r.conversation_id) ?? [];
    list.push(r);
    byConversation.set(r.conversation_id, list);
  }
  const conversations = [...byConversation.entries()]
    .map(([id, msgs]) => {
      const ordered = [...msgs].sort((a, b) => a.turn_index - b.turn_index);
      const firstUser = ordered.find((m) => m.role === "user");
      return {
        id,
        messages: ordered,
        startedAt: ordered[0]?.created_at ?? "",
        lastAt: msgs[0]?.created_at ?? "",
        opener: firstUser?.content ?? "(no customer message)",
        surface: ordered.find((m) => m.surface)?.surface ?? "—",
        proposals: ordered.reduce((n, m) => n + (m.proposal_count ?? 0), 0),
        actions: [...new Set(ordered.map((m) => m.action).filter(Boolean))] as string[],
      };
    })
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
    .slice(0, PAGE_SIZE);

  const open = openId ? byConversation.get(openId) : undefined;
  const openOrdered = open ? [...open].sort((a, b) => a.turn_index - b.turn_index) : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-serif text-2xl font-semibold">Chat logs</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Every customer conversation with Mandy. Kept {CHAT_LOG_RETENTION_DAYS}{" "}
        days, then deleted automatically. Times are Brisbane.
      </p>

      {openOrdered ? (
        <section className="mt-6 rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-semibold">Conversation</h2>
            <Link href="/admin/chats" className="text-sm text-zinc-500 hover:underline">
              ← back to list
            </Link>
          </div>
          <ul className="mt-4 space-y-3">
            {openOrdered.map((m) => (
              <li
                key={m.id}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm " +
                    (m.role === "user"
                      ? "bg-zinc-900 text-white"
                      : "bg-amber-50 text-zinc-900")
                  }
                >
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  <div
                    className={
                      "mt-1 text-[11px] " +
                      (m.role === "user" ? "text-zinc-400" : "text-zinc-500")
                    }
                  >
                    {bne(m.created_at)}
                    {m.proposal_count > 0 ? ` · ${m.proposal_count} drink(s) proposed` : ""}
                    {m.action ? ` · ${m.action}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2">Last message</th>
              <th className="px-4 py-2">Opened with</th>
              <th className="px-4 py-2">Where</th>
              <th className="px-4 py-2">Turns</th>
              <th className="px-4 py-2">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {conversations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No conversations recorded yet.
                </td>
              </tr>
            ) : (
              conversations.map((c) => (
                <tr key={c.id} className="border-t hover:bg-zinc-50">
                  <td className="whitespace-nowrap px-4 py-2 text-zinc-600">
                    {bne(c.lastAt)}
                  </td>
                  <td className="max-w-[22rem] px-4 py-2">
                    <Link
                      href={`/admin/chats?c=${encodeURIComponent(c.id)}`}
                      className="line-clamp-1 text-brand hover:underline"
                    >
                      {c.opener}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-zinc-600">{c.surface}</td>
                  <td className="px-4 py-2 text-zinc-600">{c.messages.length}</td>
                  <td className="px-4 py-2 text-zinc-600">
                    {c.actions.length > 0 ? c.actions.join(", ") : null}
                    {c.proposals > 0 ? ` ${c.proposals} drink(s)` : null}
                    {c.actions.length === 0 && c.proposals === 0 ? "—" : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
