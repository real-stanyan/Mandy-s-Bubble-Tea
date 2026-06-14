import "server-only"
import {
  bumpPassUpdatedAt,
  deleteDeviceByPushToken,
  getDevicePushTokens,
} from "./db"
import { pushToAppleWallet } from "./apns"

export interface RepushResult {
  serial: string
  pushed: number
  failures: { token: string; status: number; reason?: string }[]
  // TEMP diagnostic: raw APNs status per token (remove after debugging delivery)
  statuses?: { status: number; reason?: string }[]
}

/**
 * Touch the pass's updated_at and APNs-push every registered device so Apple
 * re-fetches a fresh pkpass. Shared by the QStash worker (loyalty events) and
 * the staff re-push admin route (manual one-off fixes). Devices that report
 * 410 (unregistered) are pruned.
 */
export async function repushPass(serial: string, pushType?: string): Promise<RepushResult> {
  await bumpPassUpdatedAt(serial)
  const tokens = await getDevicePushTokens(serial)
  const results = await pushToAppleWallet(tokens, pushType)

  for (const r of results) {
    if (r.status === 410) await deleteDeviceByPushToken(r.token)
  }

  const failures = results
    .filter((r) => r.status >= 500 || r.status === 429)
    .map((r) => ({ token: r.token, status: r.status, reason: r.reason }))

  return {
    serial,
    pushed: results.length,
    failures,
    statuses: results.map((r) => ({ status: r.status, reason: r.reason })),
  }
}
