import "server-only";
import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "./supabase-server";

// Business-logic helpers built on top of the service-role Supabase
// client. The client itself lives in supabase-server.ts; this module
// keeps domain helpers (order counter, welcome discount) separate so
// API routes don't import setup code and setup code doesn't know about
// domain logic.

function getSupabase() {
  return getSupabaseAdmin();
}

/**
 * Get the next online order number for today (OL800, OL801, …).
 * Uses a PostgreSQL function for atomic increment.
 */
export async function nextOnlineOrderNumber(): Promise<string> {
  const { data, error } = await getSupabase().rpc("next_online_order_number");
  if (error) throw new Error(`Supabase order counter failed: ${error.message}`);
  return data as string;
}

/**
 * Next scheduled-pickup order number for today (OL700, OL701, …) — its own
 * daily counter, so the OL7 prefix survives a 100-order day (the relabel
 * approach broke the first time the online counter walked into OL9xx; see
 * migration 2026-08-24-scheduled-order-counter.sql).
 *
 * Returns null past OL799 (the series would collide with real ASAP OL8xx
 * numbers) and lets errors throw — the orders route treats both as "fall
 * back to the online counter + relabel", which also covers the window
 * where the migration hasn't been applied yet.
 */
export async function nextScheduledOrderNumber(): Promise<string | null> {
  const { data, error } = await getSupabase().rpc("next_scheduled_order_number");
  if (error) throw new Error(`Supabase scheduled counter failed: ${error.message}`);
  const n = parseInt(String(data).replace(/^OL/, ""), 10);
  if (!Number.isFinite(n) || n > 799) return null;
  return data as string;
}

/**
 * Insert a welcome_discounts row for a newly-created customer.
 * Idempotent via upsert with ignoreDuplicates. Called after a fresh
 * Square customer is created in /api/customer. Swallows errors — must
 * never block signup.
 *
 * Tombstone gate: welcome_discounts is keyed by square_customer_id and
 * purgeAccount deletes it on account deletion, so delete + re-signup
 * with the same phone used to mint a fresh allowance every cycle.
 * welcome_discount_history records consumption by phone (OTP-verified,
 * survives deletion; see migration 004) — a phone present there never
 * gets a new grant. History lookup failure fails OPEN (grant anyway):
 * denying every new signup their welcome during a Supabase blip costs
 * more than the rare abuse window.
 */
export async function grantWelcomeDiscount(
  customerId: string,
  phoneE164: string,
): Promise<void> {
  try {
    const { data: consumed, error: histErr } = await getSupabase()
      .from("welcome_discount_history")
      .select("phone_e164")
      .eq("phone_e164", phoneE164)
      .maybeSingle();
    if (histErr) {
      console.error("[welcome-discount] history check failed:", histErr);
    } else if (consumed) {
      console.log(
        `[welcome-discount] grant skipped — phone already consumed welcome (customer ${customerId})`,
      );
      return;
    }

    const { error } = await getSupabase()
      .from("welcome_discounts")
      .upsert(
        { customer_id: customerId },
        { onConflict: "customer_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  } catch (err) {
    console.error("[welcome-discount] grant failed:", err);
  }
}

/**
 * Returns the customer's welcome discount state: whether any drinks
 * remain under their allowance (`available`), the 30% rate, and the
 * raw `drinksRemaining` count (0, 1, or 2) so the UI can say "1 drink
 * left on your welcome discount".
 *
 * Returns a disabled shape on any error — callers must never 500 on
 * status lookups.
 */
export async function getWelcomeDiscountStatus(
  customerId: string,
): Promise<{ available: boolean; percentage: number; drinksRemaining: number }> {
  try {
    const { data, error } = await getSupabase()
      .from("welcome_discounts")
      .select("drinks_remaining,percentage")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { available: false, percentage: 0, drinksRemaining: 0 };
    const remaining = data.drinks_remaining ?? 0;
    return {
      available: remaining > 0,
      percentage: data.percentage ?? 30,
      drinksRemaining: remaining,
    };
  } catch (err) {
    console.error("[welcome-discount] status failed:", err);
    return { available: false, percentage: 0, drinksRemaining: 0 };
  }
}

/**
 * Tear down every Supabase-side trace of an account when the Square
 * customer is gone (deleted in Square Dashboard, or detected missing on
 * session resume). Pass whichever handle you have; we look up the
 * missing one.
 *
 * Throws if releasing the unique-constrained columns (phone/email)
 * fails so the caller can surface the failure to the user — leaving
 * those columns intact would block the customer from re-registering
 * with the same number. Best-effort steps (welcome_discounts delete,
 * auth user deletion) are logged but don't throw.
 */
export async function purgeAccount(args: {
  userId?: string;
  customerId?: string;
}): Promise<void> {
  const admin = getSupabase();
  let { userId, customerId } = args;

  if (!userId && customerId) {
    const { data } = await admin
      .from("user_profiles")
      .select("user_id")
      .eq("square_customer_id", customerId)
      .maybeSingle();
    userId = data?.user_id ?? undefined;
  } else if (userId && !customerId) {
    const { data } = await admin
      .from("user_profiles")
      .select("square_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    customerId = data?.square_customer_id ?? undefined;
  }

  if (customerId) {
    const { error } = await admin
      .from("welcome_discounts")
      .delete()
      .eq("customer_id", customerId);
    if (error) console.error("[purge] welcome_discounts delete", error);

    const { error: igErr } = await admin
      .from("ig_follow_discounts")
      .delete()
      .eq("customer_id", customerId);
    if (igErr) console.error("[purge] ig_follow_discounts delete", igErr);
  }

  if (userId) {
    const { error: ocErr } = await admin
      .from("order_complaints")
      .delete()
      .eq("user_id", userId);
    if (ocErr) console.error("[purge] order_complaints delete", ocErr);
  }

  if (userId) {
    // mandy_customer_metrics carries a FK onto user_profiles
    // (mandy_customer_metrics_user_id_fkey, ON DELETE NO ACTION). It was
    // added with the broadcasts analytics feature after this purge was
    // written, so the user_profiles delete below hits
    // "violates foreign key constraint mandy_customer_metrics_user_id_fkey"
    // unless we release the child row first. Delete it explicitly — same as
    // the other children above; we deliberately don't rely on cascade
    // (see the auth.users cascade note below).
    const { error: metricsErr } = await admin
      .from("mandy_customer_metrics")
      .delete()
      .eq("user_id", userId);
    if (metricsErr) {
      console.error("[purge] mandy_customer_metrics delete failed", metricsErr);
      throw new Error(
        `Failed to release mandy_customer_metrics row: ${metricsErr.message}`,
      );
    }

    // CRITICAL: explicitly delete user_profiles BEFORE touching auth.users.
    // user_profiles owns its own UNIQUE constraint on phone_e164 (separate
    // from auth.users.phone) and we previously relied on ON DELETE CASCADE
    // from auth.users → user_profiles to clean it up. When
    // `auth.admin.deleteUser` silently fails (the swallowed error case
    // below) the cascade never fires and a zombie user_profiles row keeps
    // claiming the phone, blocking the same customer from re-registering
    // with "duplicate key value violates unique constraint
    // user_profiles_phone_e164_key". Doing it explicitly here releases
    // phone_e164 + square_customer_id regardless of whether the auth-side
    // delete succeeds.
    const { error: profErr } = await admin
      .from("user_profiles")
      .delete()
      .eq("user_id", userId);
    if (profErr) {
      console.error("[purge] user_profiles delete failed", profErr);
      throw new Error(
        `Failed to release user_profiles row: ${profErr.message}`,
      );
    }

    // CRITICAL: rewrite phone + email to inert markers BEFORE deleting
    // the auth user. Reported 2026-04-26: customers saw "Phone number
    // in use" when re-registering after Account → Delete because
    // `auth.admin.deleteUser` was silently failing (FK / soft-delete
    // mode / RLS) and the swallowed error left auth.users intact with
    // the phone column still claiming the unique constraint.
    //
    // We can't pass NULL via the SDK (typings disallow it and GoTrue
    // ignores explicit nulls in the JSON body — verified). Phone must
    // be a valid E.164 string, so we write a 14-digit number prefixed
    // "+9" (an unassigned E.164 country code). 12 random digits gives
    // a 1-in-10^12 collision space — effectively unique for one shop.
    const inertNumber = randomBytes(8).readBigUInt64BE() % 1000000000000n;
    const inertPhone = `+9${inertNumber.toString().padStart(12, "0")}`;
    const { error: clearErr } = await admin.auth.admin.updateUserById(userId, {
      phone: inertPhone,
      email: `${userId}@deleted.invalid`,
    });
    if (clearErr) {
      console.error("[purge] clear phone/email failed", clearErr);
      throw new Error(
        `Failed to release account unique fields: ${clearErr.message}`,
      );
    }

    // Best-effort hard delete. Phone/email are already released, so a
    // failure here just leaves an inert row that does not block the
    // customer from signing up again.
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) console.error("[purge] auth.admin.deleteUser", delErr);
  }
}

/**
 * Look up the Supabase user_id that owns a given Square customer id.
 * Returns null if no profile links this Square customer yet.
 */
export async function getUserIdBySquareCustomer(
  squareCustomerId: string,
): Promise<string | null> {
  const admin = getSupabase();
  const { data, error } = await admin
    .from("user_profiles")
    .select("user_id")
    .eq("square_customer_id", squareCustomerId)
    .maybeSingle();
  if (error) throw new Error(`getUserIdBySquareCustomer: ${error.message}`);
  return (data?.user_id as string | undefined) ?? null;
}

/**
 * Atomically decrements drinks_remaining by at most `count`. Returns
 * `{ consumedCount, drinksRemaining }` reflecting the post-call state.
 * Already-zero or missing rows return `{ consumedCount: 0, drinksRemaining: 0 }`.
 * Callers must not treat any partial consumption as "fully used" — the
 * row is only terminal when drinksRemaining hits 0.
 */
export async function consumeWelcomeDiscount(
  customerId: string,
  orderId: string,
  count: number,
): Promise<{ consumedCount: number; drinksRemaining: number }> {
  try {
    const { data, error } = await getSupabase().rpc(
      "consume_welcome_discount",
      {
        p_customer_id: customerId,
        p_order_id: orderId,
        p_count: count,
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!row) return { consumedCount: 0, drinksRemaining: 0 };
    return {
      consumedCount: Number(row.consumed_count ?? 0),
      drinksRemaining: Number(row.drinks_remaining ?? 0),
    };
  } catch (err) {
    console.error("[welcome-discount] consume failed:", err);
    return { consumedCount: 0, drinksRemaining: 0 };
  }
}
