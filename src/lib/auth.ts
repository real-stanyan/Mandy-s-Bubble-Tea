import "server-only";
import { getSupabaseAdmin, getSupabaseRoute } from "./supabase-server";

// API-route auth helper. Resolves the calling user from one of two
// identity carriers:
//
// 1. Cookie-based Supabase session — what the web app sends by default
//    (supabase-js writes the session cookie on sign-in and every fetch
//    inside the same origin picks it up).
// 2. `Authorization: Bearer <jwt>` header — what the RN app sends.
//    Supabase returns the JWT from its sign-in methods; the app stores
//    it and attaches it to every API request.
//
// Returns the auth user id plus the joined user_profiles row (nullable
// because a fresh OAuth user has no profile until they complete the
// phone-linking step).

export type AuthedUser = {
  userId: string;
  email: string | null;
  phone: string | null;
  profile: UserProfile | null;
};

export type UserProfile = {
  user_id: string;
  square_customer_id: string | null;
  phone_e164: string | null;
  first_name: string | null;
  last_name: string | null;
};

/**
 * Returns the authed user, or null if the request has no valid session.
 * Never throws on missing auth — callers decide whether to 401.
 */
export async function getAuthedUser(request: Request): Promise<AuthedUser | null> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (bearer) {
    // Mobile app path — validate the JWT with admin client.
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.getUser(bearer);
    if (error || !data.user) return null;
    return toAuthedUser(data.user.id, data.user.email ?? null, data.user.phone ?? null);
  }

  // Web path — cookie-based session.
  const supabase = await getSupabaseRoute();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return toAuthedUser(data.user.id, data.user.email ?? null, data.user.phone ?? null);
}

async function toAuthedUser(
  userId: string,
  email: string | null,
  phone: string | null,
): Promise<AuthedUser> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("user_profiles")
    .select("user_id, square_customer_id, phone_e164, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    userId,
    email,
    phone: phone ? normalizeSupabasePhone(phone) : null,
    profile: (data as UserProfile | null) ?? null,
  };
}

/**
 * Supabase stores the phone without a leading `+` (E.164 minus the
 * plus). The rest of our code passes phones in full E.164 (`+61...`).
 * Glue them together here so every downstream caller sees the same
 * format.
 */
function normalizeSupabasePhone(phone: string): string {
  return phone.startsWith("+") ? phone : `+${phone}`;
}
