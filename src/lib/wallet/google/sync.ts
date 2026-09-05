import "server-only"
import { fetchCustomerPassData } from "../customer"
import { getPassBySerial, getPassByCustomerId, issuePass, markGoogleIssued, type WalletPassRow } from "../db"
import { googleWalletEnv, type GoogleWalletEnv } from "./env"
import {
  ensureLoyaltyClass,
  getLoyaltyObjectStatus,
  saveUrl,
  signSaveJwt,
  upsertLoyaltyObject,
} from "./api"
import { buildLoyaltyClass, buildLoyaltyObject, googleObjectId, type LoyaltyObject } from "./pass"

// Orchestration shared by the App-facing routes and the loyalty re-push path.
// The Apple pass is the system of record for member numbers: a Google card
// reuses the same wallet_passes row, so MB-4182 is MB-4182 on both phones.

function applePassTypeId(): string {
  return process.env.APPLE_PASS_TYPE_ID ?? "pass.com.mandysbubbletea.membercard"
}

async function objectFor(env: GoogleWalletEnv, pass: WalletPassRow): Promise<LoyaltyObject> {
  const data = await fetchCustomerPassData(pass.customer_id)
  return buildLoyaltyObject(env.issuerId, env.origin, {
    serialNumber: pass.serial_number,
    memberNumber: pass.member_number,
    memberName: data.memberName,
    memberSince: data.memberSince,
    phoneE164: data.phoneE164,
    stars: data.stars,
    lifetimePoints: data.lifetimePoints,
    availableRewards: data.availableRewards,
  })
}

export interface GoogleSaveIssue {
  jwt: string
  saveUrl: string
  objectId: string
  /** false when Google's REST side was unreachable and the JWT carries the full object instead. */
  synced: boolean
}

/**
 * Issue (or refresh) the member's Google card and return the JWT the App hands
 * to `PayClient.savePassesJwt`. REST upsert first so later balance updates can
 * PATCH the object; if that fails (service account not yet authorised in the
 * console, transient outage) the JWT embeds the whole class + object so the
 * save still works — Google creates both from the JWT on save.
 */
export async function issueGoogleSave(customerId: string): Promise<GoogleSaveIssue | null> {
  const env = googleWalletEnv()
  if (!env) return null

  const pass = await issuePass({ customerId, passTypeId: applePassTypeId() })
  const cls = buildLoyaltyClass(env.issuerId, env.origin)
  const obj = await objectFor(env, pass)

  let synced = false
  try {
    await ensureLoyaltyClass(env, cls)
    await upsertLoyaltyObject(env, obj)
    synced = true
  } catch (e) {
    console.warn(`[wallet/google] REST upsert failed for ${pass.serial_number}, embedding in JWT:`, e)
  }

  const jwt = await signSaveJwt(
    env,
    synced
      ? { loyaltyObjects: [{ id: obj.id }] }
      : { loyaltyClasses: [cls], loyaltyObjects: [obj] },
  )

  await markGoogleIssued(pass.serial_number)
  return { jwt, saveUrl: saveUrl(jwt), objectId: obj.id, synced }
}

/**
 * Re-render the object from live Square data and PUT it, so the card on the
 * phone shows the new balance / tier. Called from repushPass alongside the
 * APNs push; a member who never issued a Google card is skipped.
 */
export async function syncGoogleObject(serial: string): Promise<"updated" | "skipped"> {
  const env = googleWalletEnv()
  if (!env) return "skipped"
  const pass = await getPassBySerial(serial)
  if (!pass || !pass.google_issued_at) return "skipped"
  const obj = await objectFor(env, pass)
  await upsertLoyaltyObject(env, obj)
  return "updated"
}

export interface GoogleCardStatus {
  available: boolean
  issued: boolean
  added: boolean
}

/**
 * Has this member's card been saved to Google Wallet? The App reports
 * RESULT_OK straight after the save sheet; `hasUsers` from Google covers the
 * save-link path (web, or a phone that saved before the App could report).
 */
export async function googleCardStatus(customerId: string): Promise<GoogleCardStatus> {
  const env = googleWalletEnv()
  if (!env) return { available: false, issued: false, added: false }
  const pass = await getPassByCustomerId(customerId)
  if (!pass || !pass.google_issued_at) return { available: true, issued: false, added: false }
  if (pass.google_saved_at) return { available: true, issued: true, added: true }
  try {
    const status = await getLoyaltyObjectStatus(env, googleObjectId(env.issuerId, pass.serial_number))
    return { available: true, issued: true, added: status.hasUsers }
  } catch (e) {
    console.warn(`[wallet/google] status lookup failed for ${pass.serial_number}:`, e)
    return { available: true, issued: true, added: false }
  }
}
