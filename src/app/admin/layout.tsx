import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSupabaseAdmin, getSupabaseRoute } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ssr = await getSupabaseRoute();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) redirect("/");
  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("admin_users")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) notFound();
  return (
    <>
      {/* Admin pages were reachable by typed URL only. A second page made
          that a real problem, so this is the minimum index — not a design. */}
      <nav className="border-b bg-white px-6 py-3 text-sm">
        <ul className="mx-auto flex max-w-6xl gap-4">
          <li>
            <Link href="/admin/prints" className="hover:underline">
              Print jobs
            </Link>
          </li>
          <li>
            <Link href="/admin/loyalty-push" className="hover:underline">
              Loyalty pushes
            </Link>
          </li>
          <li>
            <Link href="/admin/chats" className="hover:underline">
              Chat logs
            </Link>
          </li>
        </ul>
      </nav>
      {children}
    </>
  );
}
