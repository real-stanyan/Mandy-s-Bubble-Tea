import "server-only";
import { getSupabaseAdmin, getSupabaseRoute } from "@/lib/supabase-server";

/**
 * Resolve the calling user's id if they are an admin, else null.
 *
 * The /admin pages are gated by src/app/admin/layout.tsx, but that only
 * covers navigation — the API routes are reachable directly, so each one
 * has to re-check. This lived as a copy-pasted local helper in every admin
 * route; it is one implementation now so a fix to the check cannot land in
 * three places and miss the fourth.
 */
export async function getAdminUserId(): Promise<string | null> {
  const ssr = await getSupabaseRoute();
  const {
    data: { user },
  } = await ssr.auth.getUser();
  if (!user) return null;
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("admin_users")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  return data ? user.id : null;
}
