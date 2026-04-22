import "server-only";
import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface WalletPassRow {
  serial_number: string;
  customer_id: string;
  member_number: string;
  auth_token: string;
  pass_type_id: string;
  created_at: string;
  updated_at: string;
}

export interface WalletPassDeviceRow {
  device_library_id: string;
  serial_number: string;
  push_token: string;
  registered_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function db() {
  return getSupabaseAdmin();
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

// ---------------------------------------------------------------------------
// Pass queries
// ---------------------------------------------------------------------------

export async function getPassByCustomerId(
  customerId: string,
): Promise<WalletPassRow | null> {
  const { data, error } = await db()
    .from("wallet_passes")
    .select("*")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(`getPassByCustomerId: ${error.message}`);
  return data as WalletPassRow | null;
}

export async function getPassBySerial(
  serial: string,
): Promise<WalletPassRow | null> {
  const { data, error } = await db()
    .from("wallet_passes")
    .select("*")
    .eq("serial_number", serial)
    .maybeSingle();
  if (error) throw new Error(`getPassBySerial: ${error.message}`);
  return data as WalletPassRow | null;
}

/**
 * Idempotent: if a pass already exists for this customer, return it.
 * Otherwise allocate a new serial + member number and insert a fresh row.
 */
export async function issuePass(args: {
  customerId: string;
  passTypeId: string;
}): Promise<WalletPassRow> {
  const { customerId, passTypeId } = args;

  // Check for existing pass first.
  const existing = await getPassByCustomerId(customerId);
  if (existing) return existing;

  // Reserve the next member number via Postgres sequence.
  const { data: nextNum, error: seqErr } = await db().rpc("next_member_number");
  if (seqErr) throw new Error(`issuePass sequence: ${seqErr.message}`);
  const memberNum = Number(nextNum);

  const serialNumber = `mb-${memberNum}-${hex(4)}`;
  const memberNumber = `MB-${memberNum}`;
  const authToken = hex(16);

  const row = {
    serial_number: serialNumber,
    customer_id: customerId,
    member_number: memberNumber,
    auth_token: authToken,
    pass_type_id: passTypeId,
  };

  const { data, error } = await db()
    .from("wallet_passes")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    // Unique constraint violation (race): another request inserted first.
    // Re-fetch rather than surfacing a 500.
    if (error.code === "23505") {
      const retry = await getPassByCustomerId(customerId);
      if (retry) return retry;
    }
    throw new Error(`issuePass insert: ${error.message}`);
  }

  return data as WalletPassRow;
}

/**
 * Touch updated_at so registered devices know a push update is needed.
 */
export async function bumpPassUpdatedAt(serial: string): Promise<void> {
  const { error } = await db()
    .from("wallet_passes")
    .update({ updated_at: new Date().toISOString() })
    .eq("serial_number", serial);
  if (error) throw new Error(`bumpPassUpdatedAt: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Device registration
// ---------------------------------------------------------------------------

export async function registerDevice(args: {
  deviceLibraryId: string;
  serialNumber: string;
  pushToken: string;
}): Promise<"created" | "exists"> {
  const { deviceLibraryId, serialNumber, pushToken } = args;

  const { error } = await db()
    .from("wallet_pass_devices")
    .insert({
      device_library_id: deviceLibraryId,
      serial_number: serialNumber,
      push_token: pushToken,
    });

  if (error) {
    // 23505 = unique_violation (already registered)
    if (error.code === "23505") return "exists";
    throw new Error(`registerDevice: ${error.message}`);
  }

  return "created";
}

export async function unregisterDevice(args: {
  deviceLibraryId: string;
  serialNumber: string;
}): Promise<void> {
  const { deviceLibraryId, serialNumber } = args;
  const { error } = await db()
    .from("wallet_pass_devices")
    .delete()
    .eq("device_library_id", deviceLibraryId)
    .eq("serial_number", serialNumber);
  if (error) throw new Error(`unregisterDevice: ${error.message}`);
}

export async function getDevicePushTokens(serial: string): Promise<string[]> {
  const { data, error } = await db()
    .from("wallet_pass_devices")
    .select("push_token")
    .eq("serial_number", serial);
  if (error) throw new Error(`getDevicePushTokens: ${error.message}`);
  return (data ?? []).map((r: { push_token: string }) => r.push_token);
}

export async function deleteDeviceByPushToken(token: string): Promise<void> {
  const { error } = await db()
    .from("wallet_pass_devices")
    .delete()
    .eq("push_token", token);
  if (error) throw new Error(`deleteDeviceByPushToken: ${error.message}`);
}

/**
 * Returns all serial numbers registered to a device, optionally filtered to
 * those updated after `passesUpdatedSince`. Also returns the max updated_at
 * across returned passes (used in the Apple Wallet `Last-Modified` header).
 *
 * Uses a two-query approach for reliability (the !inner join syntax requires
 * PostgREST to infer the FK relationship at runtime, which may not always
 * reflect in the local JS client's type cache).
 */
export async function listSerialsForDevice(
  deviceLibraryId: string,
  passesUpdatedSince?: string,
): Promise<{ serials: string[]; lastUpdated: string }> {
  // Step 1: get all serials the device has registered.
  const { data: devs, error: devErr } = await db()
    .from("wallet_pass_devices")
    .select("serial_number")
    .eq("device_library_id", deviceLibraryId);
  if (devErr) throw new Error(`listSerialsForDevice (devices): ${devErr.message}`);

  const serials = (devs ?? []).map(
    (d: { serial_number: string }) => d.serial_number,
  );

  if (serials.length === 0) {
    return { serials: [], lastUpdated: new Date(0).toISOString() };
  }

  // Step 2: filter passes by optional updated_since threshold.
  let q = db()
    .from("wallet_passes")
    .select("serial_number, updated_at")
    .in("serial_number", serials);

  if (passesUpdatedSince) {
    q = q.gt("updated_at", passesUpdatedSince);
  }

  const { data: passes, error: passErr } = await q;
  if (passErr) throw new Error(`listSerialsForDevice (passes): ${passErr.message}`);

  const rows = (passes ?? []) as { serial_number: string; updated_at: string }[];
  const resultSerials = rows.map((p) => p.serial_number);
  const timestamps = rows.map((p) => p.updated_at);
  const lastUpdated =
    timestamps.length > 0
      ? timestamps.reduce((a, b) => (a > b ? a : b))
      : new Date(0).toISOString();

  return { serials: resultSerials, lastUpdated };
}

// ---------------------------------------------------------------------------
// Exchange tokens (app → browser handoff)
// ---------------------------------------------------------------------------

/** Issue a single-use, 60-second exchange token for the given customer. */
export async function issueExchangeToken(
  customerId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = hex(32); // 64 hex chars
  const expiresAt = new Date(Date.now() + 60_000);

  const { error } = await db().from("wallet_exchange_tokens").insert({
    token,
    customer_id: customerId,
    expires_at: expiresAt.toISOString(),
  });

  if (error) throw new Error(`issueExchangeToken: ${error.message}`);
  return { token, expiresAt };
}

/**
 * Consume an exchange token. Returns the customerId on success, or null if
 * the token is unknown, expired, or already consumed. Marks `consumed_at`
 * atomically so the token cannot be used twice.
 */
export async function consumeExchangeToken(
  token: string,
): Promise<string | null> {
  // Look up the token first.
  const { data, error: fetchErr } = await db()
    .from("wallet_exchange_tokens")
    .select("customer_id, expires_at, consumed_at")
    .eq("token", token)
    .maybeSingle();

  if (fetchErr) throw new Error(`consumeExchangeToken (fetch): ${fetchErr.message}`);
  if (!data) return null;

  const row = data as {
    customer_id: string;
    expires_at: string;
    consumed_at: string | null;
  };

  // Reject if already consumed or expired.
  if (row.consumed_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  // Mark consumed. Use a conditional update to guard against the race where
  // two requests arrive simultaneously — only the one that does the update
  // (consumed_at IS NULL) will succeed. We select the token back to confirm
  // the row was actually updated (i.e. consumed_at was still NULL).
  const { data: updated, error: updateErr } = await db()
    .from("wallet_exchange_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("token", token)
    .is("consumed_at", null)
    .select("token");

  if (updateErr) throw new Error(`consumeExchangeToken (update): ${updateErr.message}`);

  // If another request consumed it first, no rows will be returned.
  if (!updated || updated.length === 0) return null;

  return row.customer_id;
}
