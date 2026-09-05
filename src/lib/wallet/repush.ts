import "server-only"
import {
  bumpPassUpdatedAt,
  deleteDeviceByPushToken,
  getDevicePushTokens,
} from "./db"
import { pushToAppleWallet } from "./apns"
import { syncGoogleObject } from "./google/sync"

export interface RepushResult {
  serial: string
  pushed: number
  /** Google Wallet object re-rendered ("updated"), or no Google card / not configured ("skipped"). */
  google: "updated" | "skipped" | "failed"
  failures: { token: string; status: number; reason?: string }[]
}

/**
 * Touch the pass's updated_at and APNs-push every registered device so Apple
 * re-fetches a fresh pkpass; then rewrite the Google Wallet object if the
 * member has one. Shared by the QStash worker (loyalty events) and
 * the staff re-push admin route (manual one-off fixes). Devices that report
 * 410 (unregistered) are pruned.
 */
export async function repushPass(serial: string): Promise<RepushResult> {
  await bumpPassUpdatedAt(serial)
  const tokens = await getDevicePushTokens(serial)
  const results = await pushToAppleWallet(tokens)

  for (const r of results) {
    if (r.status === 410) await deleteDeviceByPushToken(r.token)
  }

  const failures = results
    .filter((r) => r.status >= 500 || r.status === 429)
    .map((r) => ({ token: r.token, status: r.status, reason: r.reason }))

  // Google has no push token: the object is rewritten in place and Google
  // refreshes the card itself. A Google failure must not mask the Apple
  // result, so it is reported, not thrown.
  let google: RepushResult["google"] = "skipped"
  try {
    google = await syncGoogleObject(serial)
  } catch (e) {
    console.warn(`[wallet] google sync failed for ${serial}:`, e)
    google = "failed"
  }

  return { serial, pushed: results.length, failures, google }
}
