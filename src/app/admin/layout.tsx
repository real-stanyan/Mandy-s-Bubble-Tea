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
  return <>{children}</>;
}
